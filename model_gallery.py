"""Model Gallery — backend node + HTTP endpoints.

Uses ComfyUI-bundled libraries ONLY (aiohttp, plus folder_paths / server
from ComfyUI core). Do not add a Python dependency that ComfyUI does not
already ship; if a feature needs one, make it a separate companion pack.

v0.1 surface:

  - GET /model_gallery/list?category=<folder_paths category>
      Enumerate a folder_paths category (e.g. "loras", "checkpoints",
      "vae", ...) and return its filenames with mtime + subfolder.
      Mirrors gallery-loader's /list contract:
        success -> {"ok": True, "category": ..., "items": [...]}
        failure -> {"ok": False, "error": ...}  (never raises into aiohttp)

  - GET /model_gallery/meta?category=<cat>&name=<name>
      Read the embedded header metadata of a single model file (base-model
      architecture, LoRA training info, trigger/common tags, title). Pairs
      with the frontend's filename-heuristic corpus: the corpus is the
      instant, universal guess; this is the authoritative read when the file
      actually carries metadata. Only .safetensors/.sft headers are parsed
      (struct + json, both bundled — NO new deps); other formats return
      ``supported: False`` and the frontend falls back to the corpus.
      The path is resolved ONLY through folder_paths.get_full_path — never an
      arbitrary caller path — so a crafted ?name= cannot escape the category
      roots folder_paths already vetted.

  - GET /model_gallery/thumb  (v0.2 — sibling-preview thumbnails)
      Stubbed: returns 404. The ALLOWED_EXTENSIONS whitelist below is the
      security perimeter for when this lands — an arbitrary-path read MUST
      gate on it. Kept here so the security contract is visible from day one.

Deferred (tier 3, not implemented): a hash → Civitai by-hash lookup would
identify a file authoritatively even with no embedded metadata, but it needs
a full-file SHA256 (GBs of disk I/O, must be cached) plus outbound network to
a third party (privacy + offline concerns). It is intentionally left out of
this offline-by-default surface; add it behind an explicit opt-in if wanted.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import struct
from typing import Any

import folder_paths
from aiohttp import web
from server import PromptServer

log = logging.getLogger("comfyui-model-gallery")

# Extensions this pack will read off disk for the future /thumb endpoint.
# Any arbitrary-path endpoint MUST gate on this whitelist — never read an
# absolute path without checking. Widen it explicitly for any new preview
# format. /list never reads file contents, so it does not consult this set;
# it only enumerates names folder_paths already vetted.
ALLOWED_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp"}

# Extensions whose header we know how to parse for embedded metadata. Reading
# is gated on this set AND on folder_paths resolution — never read a header
# off a path folder_paths didn't hand us.
SAFETENSORS_EXTENSIONS = {".safetensors", ".sft"}

# A safetensors header is a u64 length + that many bytes of JSON. Real headers
# are KB-to-low-MB; cap the declared length so a corrupt/hostile file can't make
# us allocate gigabytes. 64 MiB is far above any legitimate header.
SAFETENSORS_HEADER_MAX = 64 * 1024 * 1024

# Tiny mtime-keyed cache so reopening the picker doesn't re-read headers. Keyed
# on (path, mtime, size) — any on-disk change invalidates the entry. Bounded so
# a long-lived server enumerating huge folders can't grow it without limit.
_META_CACHE: dict[tuple[str, float, int], dict[str, Any]] = {}
_META_CACHE_MAX = 4096

# folder_paths categories this pack is willing to enumerate. This is a
# guard, not the source of truth — the frontend maps widget names to these
# strings, and folder_paths.get_filename_list is the authority on contents.
# Keeping an explicit allowlist means a crafted ?category= can't probe
# arbitrary registered folder types. Mirrors the widget→category map in
# src/model-gallery.ts.
KNOWN_CATEGORIES = {
    "loras",
    "checkpoints",
    "vae",
    "controlnet",
    "diffusion_models",
    "text_encoders",
    "clip",
    "clip_vision",
    "style_models",
    "gligen",
    "upscale_models",
    "hypernetworks",
    "photomaker",
}


def _resolve_mtime(category: str, name: str) -> float | None:
    """Return the mtime of the on-disk file backing ``name`` in ``category``.

    ``folder_paths.get_full_path`` searches every registered root for the
    category and returns the first match (or None). Returns None when the
    file can't be stat'd — a broken symlink, a race with deletion, or a
    registry/disk mismatch — so the caller can still surface the entry
    without a timestamp rather than dropping it.
    """
    try:
        full = folder_paths.get_full_path(category, name)
    except Exception:  # folder_paths can raise on an unknown category
        return None
    if not full:
        return None
    try:
        return os.stat(full).st_mtime
    except OSError:
        return None


def _split_subfolder(name: str) -> tuple[str, str]:
    """Split a folder_paths relative name into (subfolder, basename).

    folder_paths returns entries like ``"flux/realism.safetensors"`` for
    files nested under a category root. The subfolder is everything up to
    the last separator; it is "" for a top-level file. Backslashes (Windows
    roots) are normalised to forward slashes so the frontend's chip filter
    and fuzzy search see one separator.
    """
    norm = name.replace("\\", "/")
    idx = norm.rfind("/")
    if idx < 0:
        return "", norm
    return norm[:idx], norm[idx + 1 :]


# Map a model file's declared architecture / base-model string onto a short,
# friendly base label the UI can badge. Ordered most-specific first (the first
# substring hit wins). Falls back to the raw string so an unrecognised but
# present value still surfaces rather than vanishing.
_BASE_LABELS = (
    ("flux", "Flux.1"),
    ("stable-diffusion-xl", "SDXL"),
    ("sdxl", "SDXL"),
    ("stable-diffusion-3", "SD 3.x"),
    ("sd3", "SD 3.x"),
    ("stable-cascade", "Stable Cascade"),
    ("stable-diffusion-2", "SD 2.x"),
    ("sd_v2", "SD 2.x"),
    ("stable-diffusion-v1", "SD 1.5"),
    ("sd_v1", "SD 1.5"),
    ("pony", "SDXL (Pony)"),
)


def _friendly_base(*candidates: str | None) -> str | None:
    """Resolve a friendly base-model label from architecture/base strings."""
    for cand in candidates:
        if not cand:
            continue
        low = cand.lower()
        for needle, label in _BASE_LABELS:
            if needle in low:
                return label
    # No known mapping — surface the first non-empty raw value verbatim.
    for cand in candidates:
        if cand:
            return cand
    return None


def _top_tags(raw: Any, limit: int = 12) -> list[str]:
    """Aggregate kohya's ``ss_tag_frequency`` into the most-frequent tags.

    The field is a JSON *string* mapping dataset -> {tag: count}. Summed across
    datasets and sorted by descending frequency, the top tags are the closest
    proxy a LoRA stores to its trigger words. Returns [] on anything malformed.
    """
    if not isinstance(raw, str):
        return []
    try:
        data = json.loads(raw)
    except (ValueError, TypeError):
        return []
    if not isinstance(data, dict):
        return []
    counts: dict[str, int] = {}
    for dataset in data.values():
        if not isinstance(dataset, dict):
            continue
        for tag, count in dataset.items():
            label = str(tag).strip()
            if not label:
                continue
            try:
                n = int(count)
            except (TypeError, ValueError):
                n = 0
            counts[label] = counts.get(label, 0) + n
    ordered = sorted(counts.items(), key=lambda kv: (-kv[1], kv[0]))
    return [tag for tag, _ in ordered[:limit]]


def _read_safetensors_metadata(path: str) -> dict[str, Any] | None:
    """Return the ``__metadata__`` map from a safetensors header, or None.

    Reads ONLY the header (8-byte little-endian length + that many JSON bytes),
    never the tensor payload, so it's a small read regardless of file size.
    Returns None on any structural problem (truncated, oversize, non-JSON) and
    {} when the header is valid but carries no __metadata__.
    """
    with open(path, "rb") as fh:
        size_bytes = fh.read(8)
        if len(size_bytes) < 8:
            return None
        (header_len,) = struct.unpack("<Q", size_bytes)
        if header_len <= 0 or header_len > SAFETENSORS_HEADER_MAX:
            return None
        raw = fh.read(header_len)
    if len(raw) < header_len:
        return None
    try:
        header = json.loads(raw)
    except (ValueError, UnicodeDecodeError):
        return None
    if not isinstance(header, dict):
        return None
    meta = header.get("__metadata__")
    return meta if isinstance(meta, dict) else {}


def _curate_metadata(meta: dict[str, Any]) -> dict[str, Any]:
    """Distil a raw safetensors __metadata__ map into the UI's curated subset.

    Pulls the high-signal keys the picker shows (base, title, network/training
    info for LoRAs, common tags). Skips empties so the frontend can treat any
    present key as meaningful. All safetensors metadata values are strings;
    they're surfaced verbatim except tags (parsed) and a length-capped
    description.
    """
    arch = meta.get("modelspec.architecture")
    base_ver = meta.get("ss_base_model_version")
    out: dict[str, Any] = {}

    base = _friendly_base(arch, base_ver)
    if base:
        out["base"] = base
    if arch:
        out["arch"] = arch
    if base_ver:
        out["base_model_version"] = base_ver

    title = meta.get("modelspec.title")
    if title:
        out["title"] = title
    description = meta.get("modelspec.description")
    if isinstance(description, str) and description.strip():
        out["description"] = description.strip()[:500]

    network_module = meta.get("ss_network_module")
    if network_module:
        out["network_module"] = network_module
    rank = meta.get("ss_network_dim")
    if rank:
        out["rank"] = rank
    alpha = meta.get("ss_network_alpha")
    if alpha:
        out["alpha"] = alpha
    resolution = meta.get("modelspec.resolution") or meta.get("ss_resolution")
    if resolution:
        out["resolution"] = resolution

    tags = _top_tags(meta.get("ss_tag_frequency"))
    if tags:
        out["tags"] = tags

    sha = meta.get("modelspec.hash_sha256") or meta.get("sshs_model_hash")
    if sha:
        out["sha256"] = sha

    return out


def _read_curated_metadata(path: str) -> dict[str, Any]:
    """Header-read + curate for one file. Synchronous (run off the event loop).

    Never raises into the caller: any read error degrades to {} so the endpoint
    reports "no embedded metadata" rather than failing.
    """
    try:
        meta = _read_safetensors_metadata(path)
    except OSError as exc:
        log.warning("safetensors header read failed for %s: %s", path, exc)
        return {}
    if not meta:
        return {}
    try:
        return _curate_metadata(meta)
    except Exception:  # one weird value must not sink the whole read
        log.warning("metadata curation failed for %s", path, exc_info=True)
        return {}


def _meta_cache_put(key: tuple[str, float, int], value: dict[str, Any]) -> None:
    """Insert into the bounded meta cache, evicting an arbitrary entry if full."""
    if len(_META_CACHE) >= _META_CACHE_MAX:
        # Cheap bound: drop one existing entry. Order is unimportant — this is a
        # latency cache, not a correctness store (every key embeds mtime+size).
        _META_CACHE.pop(next(iter(_META_CACHE)), None)
    _META_CACHE[key] = value


@PromptServer.instance.routes.get("/model_gallery/list")
async def model_list(request: web.Request) -> web.Response:
    """List the files in a folder_paths category for the picker modal.

    Query params:
      category — a folder_paths category ("loras", "checkpoints", ...).

    Returns {"ok": True, "category": ..., "items": [{name, subfolder,
    mtime}, ...]}. ``name`` is the EXACT string folder_paths.get_filename_list
    returns — i.e. the value the native combo uses. The frontend writes that
    back verbatim (value contract: don't churn workflows).
    """
    category = request.rel_url.query.get("category", "")
    if not category:
        return web.json_response({"ok": False, "error": "missing category"}, status=400)
    if category not in KNOWN_CATEGORIES:
        return web.json_response(
            {"ok": False, "error": f"unknown category: {category}"}, status=400
        )

    try:
        names = folder_paths.get_filename_list(category)
    except Exception as exc:  # never raise into aiohttp dispatch
        log.warning("get_filename_list(%s) failed: %s", category, exc)
        return web.json_response({"ok": False, "error": str(exc)}, status=500)

    items: list[dict[str, Any]] = []
    for name in names:
        try:
            subfolder, _basename = _split_subfolder(name)
            items.append(
                {
                    "name": name,  # exact combo value — do NOT normalise
                    "subfolder": subfolder,
                    "mtime": _resolve_mtime(category, name),
                }
            )
        except Exception:  # one bad entry must not drop the whole listing
            continue

    return web.json_response({"ok": True, "category": category, "items": items})


@PromptServer.instance.routes.get("/model_gallery/meta")
async def model_meta(request: web.Request) -> web.Response:
    """Read one model file's embedded header metadata for the picker.

    Query params:
      category — a folder_paths category ("loras", "checkpoints", ...).
      name     — the EXACT folder_paths combo value (may include a subfolder).

    Returns {"ok": True, "supported": <bool>, "format": <ext>, "meta": {...}}.
    ``meta`` is the curated subset (base, title, rank/alpha, tags, ...); it is
    {} when the file carries no usable header metadata. ``supported`` is False
    for formats whose header we don't parse (.ckpt/.pth/.gguf) so the frontend
    falls back to the filename corpus without treating it as an error.

    Security: the path is resolved ONLY via folder_paths.get_full_path against a
    whitelisted category, so ?name= can't read outside the registered roots.
    """
    category = request.rel_url.query.get("category", "")
    name = request.rel_url.query.get("name", "")
    if not category or not name:
        return web.json_response({"ok": False, "error": "missing category or name"}, status=400)
    if category not in KNOWN_CATEGORIES:
        return web.json_response(
            {"ok": False, "error": f"unknown category: {category}"}, status=400
        )

    try:
        full = folder_paths.get_full_path(category, name)
    except Exception as exc:  # folder_paths can raise on a bad category/name
        log.warning("get_full_path(%s, %s) failed: %s", category, name, exc)
        full = None
    if not full:
        return web.json_response({"ok": False, "error": "not found"}, status=404)

    ext = os.path.splitext(full)[1].lower()
    if ext not in SAFETENSORS_EXTENSIONS:
        # Known file, format we don't introspect — not an error; the corpus
        # heuristic still covers it on the frontend.
        return web.json_response(
            {"ok": True, "supported": False, "format": ext.lstrip("."), "meta": {}}
        )

    try:
        stat = os.stat(full)
    except OSError:
        return web.json_response({"ok": False, "error": "not found"}, status=404)

    cache_key = (full, stat.st_mtime, stat.st_size)
    meta = _META_CACHE.get(cache_key)
    if meta is None:
        # Header read is small but still blocking I/O — keep it off the event
        # loop so a slow/network filesystem can't stall other requests.
        meta = await asyncio.get_event_loop().run_in_executor(None, _read_curated_metadata, full)
        _meta_cache_put(cache_key, meta)

    return web.json_response(
        {"ok": True, "supported": True, "format": "safetensors", "meta": meta}
    )


@PromptServer.instance.routes.get("/model_gallery/thumb")
async def model_thumb(request: web.Request) -> web.Response:
    """Sibling-preview thumbnail endpoint — v0.2, not implemented in v0.1.

    When this lands it will serve the Civitai-style sibling image that sits
    next to a model file. It reads an arbitrary path off disk, so it MUST
    gate on ALLOWED_EXTENSIONS before opening anything. Until then it 404s
    so a stray fetch degrades gracefully (the frontend falls back to a name
    card with no thumbnail).
    """
    return web.json_response({"ok": False, "error": "thumbnails are v0.2"}, status=404)


class ModelGallery:
    """Marker node so the pack registers as a custom-node module.

    The pack is an interaction enhancer — the real work is the frontend
    modal over native model combos plus the /list endpoint. This node has
    no inputs or outputs; it exists only so ComfyUI loads the module (and
    thus registers the routes above). It is hidden from the common add-node
    paths by living in its own category.
    """

    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {}}

    RETURN_TYPES = ()
    FUNCTION = "run"
    CATEGORY = "Model Gallery"

    def run(self):
        return ()


NODE_CLASS_MAPPINGS = {"ModelGallery": ModelGallery}
NODE_DISPLAY_NAME_MAPPINGS = {"ModelGallery": "Model Gallery"}
