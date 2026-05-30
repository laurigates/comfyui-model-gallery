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

  - GET /model_gallery/thumb  (v0.2 — sibling-preview thumbnails)
      Stubbed: returns 404. The ALLOWED_EXTENSIONS whitelist below is the
      security perimeter for when this lands — an arbitrary-path read MUST
      gate on it. Kept here so the security contract is visible from day one.
"""

from __future__ import annotations

import logging
import os
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

# folder_paths categories this pack is willing to enumerate. This is a
# guard, not the source of truth — the frontend maps widget names to these
# strings, and folder_paths.get_filename_list is the authority on contents.
# Keeping an explicit allowlist means a crafted ?category= can't probe
# arbitrary registered folder types. Mirrors the widget→category map in
# web/js/model-gallery.js.
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
