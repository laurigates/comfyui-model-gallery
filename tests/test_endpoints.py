"""Tests for the /model_gallery/list endpoint and its pure helpers.

folder_paths is stubbed in conftest.py; each test sets the specific
attributes it needs on the stub. Endpoint handlers are awaited directly with
a fake aiohttp request (also from conftest).
"""

from __future__ import annotations

import asyncio
import json
import pathlib
import re
import struct

import folder_paths
from aiohttp.web import Request

import model_gallery as pack


def _write_safetensors(path, header_obj) -> None:
    """Write a minimal safetensors file: u64 header length + JSON + payload."""
    raw = json.dumps(header_obj).encode("utf-8")
    with open(path, "wb") as fh:
        fh.write(struct.pack("<Q", len(raw)))
        fh.write(raw)
        fh.write(b"\x00\x00\x00\x00")  # dummy tensor bytes — never read


ROOT = pathlib.Path(__file__).resolve().parent.parent
# The frontend is now TypeScript (src/model-gallery.ts), compiled to
# web/dist/ via `bun build`. The category-gate consistency test parses the
# WIDGET_CATEGORY map straight out of the TS source (no JS execution).
JS_SRC = (ROOT / "src" / "model-gallery.ts").read_text()


def _call(handler, **query):
    return asyncio.run(handler(Request(query=query)))


# ---------------------------------------------------------------------------
# Pure helpers
# ---------------------------------------------------------------------------


def test_split_subfolder_top_level():
    assert pack._split_subfolder("model.safetensors") == ("", "model.safetensors")


def test_split_subfolder_nested():
    assert pack._split_subfolder("flux/realism.safetensors") == (
        "flux",
        "realism.safetensors",
    )


def test_split_subfolder_deep_nested():
    assert pack._split_subfolder("a/b/c.ckpt") == ("a/b", "c.ckpt")


def test_split_subfolder_normalises_backslashes():
    assert pack._split_subfolder("flux\\realism.safetensors") == (
        "flux",
        "realism.safetensors",
    )


def test_stat_file_none_when_no_full_path():
    folder_paths.get_full_path = lambda category, name: None
    assert pack._stat_file("loras", "missing.safetensors") == (None, None)


def test_stat_file_returns_mtime_and_size(tmp_path):
    f = tmp_path / "model.safetensors"
    f.write_bytes(b"xyz")
    folder_paths.get_full_path = lambda category, name: str(f)
    mtime, size = pack._stat_file("loras", "model.safetensors")
    assert isinstance(mtime, float)
    assert mtime > 0
    assert size == 3


def test_stat_file_none_on_stat_error():
    folder_paths.get_full_path = lambda category, name: "/no/such/file.safetensors"
    assert pack._stat_file("loras", "model.safetensors") == (None, None)


# ---------------------------------------------------------------------------
# /model_gallery/list endpoint
# ---------------------------------------------------------------------------


def test_list_missing_category_is_400():
    resp = _call(pack.model_list)
    assert resp.status == 400
    assert resp.json_body["ok"] is False


def test_list_unknown_category_is_400():
    resp = _call(pack.model_list, category="../../etc")
    assert resp.status == 400
    assert resp.json_body["ok"] is False
    assert "unknown category" in resp.json_body["error"]


def test_list_returns_items_with_exact_names(tmp_path):
    # Two entries, one nested. folder_paths returns the exact combo strings.
    names = ["base.safetensors", "flux/realism.safetensors"]
    folder_paths.get_filename_list = lambda category: list(names)
    folder_paths.get_full_path = lambda category, name: None  # mtime -> None

    resp = _call(pack.model_list, category="loras")
    assert resp.status == 200
    body = resp.json_body
    assert body["ok"] is True
    assert body["category"] == "loras"

    items = body["items"]
    assert [it["name"] for it in items] == names  # exact, not normalised
    by_name = {it["name"]: it for it in items}
    assert by_name["base.safetensors"]["subfolder"] == ""
    assert by_name["flux/realism.safetensors"]["subfolder"] == "flux"
    assert all(it["mtime"] is None for it in items)
    assert all(it["size"] is None for it in items)


def test_list_populates_mtime_and_size(tmp_path):
    f = tmp_path / "model.safetensors"
    f.write_bytes(b"abcdef")
    folder_paths.get_filename_list = lambda category: ["model.safetensors"]
    folder_paths.get_full_path = lambda category, name: str(f)

    resp = _call(pack.model_list, category="checkpoints")
    item = resp.json_body["items"][0]
    assert isinstance(item["mtime"], float)
    assert item["size"] == 6


def test_list_handles_folder_paths_raising():
    def _boom(category):
        raise RuntimeError("registry exploded")

    folder_paths.get_filename_list = _boom
    resp = _call(pack.model_list, category="vae")
    assert resp.status == 500
    assert resp.json_body["ok"] is False
    assert "registry exploded" in resp.json_body["error"]


def test_list_empty_category_is_ok():
    folder_paths.get_filename_list = lambda category: []
    resp = _call(pack.model_list, category="upscale_models")
    assert resp.status == 200
    assert resp.json_body["ok"] is True
    assert resp.json_body["items"] == []


# ---------------------------------------------------------------------------
# /model_gallery/thumb stub (v0.2)
# ---------------------------------------------------------------------------


def test_thumb_is_stubbed_404():
    resp = _call(pack.model_thumb, path="/whatever.png")
    assert resp.status == 404
    assert resp.json_body["ok"] is False


def test_allowed_extensions_whitelist_present():
    # The security perimeter for the future /thumb endpoint must stay defined.
    assert ".png" in pack.ALLOWED_EXTENSIONS
    assert ".safetensors" not in pack.ALLOWED_EXTENSIONS


# ---------------------------------------------------------------------------
# Embedded-metadata helpers (safetensors header read)
# ---------------------------------------------------------------------------


def test_read_safetensors_metadata_extracts_metadata(tmp_path):
    f = tmp_path / "lora.safetensors"
    _write_safetensors(f, {"__metadata__": {"ss_network_dim": "32"}, "t": {}})
    assert pack._read_safetensors_metadata(str(f)) == {"ss_network_dim": "32"}


def test_read_safetensors_metadata_empty_when_no_metadata_key(tmp_path):
    f = tmp_path / "ckpt.safetensors"
    _write_safetensors(f, {"some.tensor": {"dtype": "F16"}})
    assert pack._read_safetensors_metadata(str(f)) == {}


def test_read_safetensors_metadata_none_on_truncated_header(tmp_path):
    f = tmp_path / "short.safetensors"
    f.write_bytes(b"\x01\x02")  # fewer than 8 length bytes
    assert pack._read_safetensors_metadata(str(f)) is None


def test_read_safetensors_metadata_none_on_oversize_header(tmp_path):
    f = tmp_path / "huge.safetensors"
    f.write_bytes(struct.pack("<Q", pack.SAFETENSORS_HEADER_MAX + 1))
    assert pack._read_safetensors_metadata(str(f)) is None


def test_read_safetensors_metadata_none_on_bad_json(tmp_path):
    f = tmp_path / "garbage.safetensors"
    raw = b"this is not json"
    f.write_bytes(struct.pack("<Q", len(raw)) + raw)
    assert pack._read_safetensors_metadata(str(f)) is None


def test_read_safetensors_header_returns_full_dict(tmp_path):
    f = tmp_path / "full.safetensors"
    header = {
        "__metadata__": {"ss_network_dim": "8"},
        "w": {"dtype": "F16", "shape": [2, 3], "data_offsets": [0, 12]},
    }
    _write_safetensors(f, header)
    out = pack._read_safetensors_header(str(f))
    assert out["__metadata__"] == {"ss_network_dim": "8"}
    assert out["w"]["dtype"] == "F16"


def test_tensor_stats_params_and_dominant_dtype():
    header = {
        "__metadata__": {"x": "y"},  # skipped
        "big": {"dtype": "BF16", "shape": [1000, 1000]},  # 1_000_000 elems
        "small": {"dtype": "F32", "shape": [10, 10]},  # 100 elems
    }
    out = pack._tensor_stats(header)
    assert out["params"] == 1_000_100
    assert out["dtype"] == "bf16"  # BF16 dominates by element count


def test_tensor_stats_maps_fp8_and_handles_empty():
    assert pack._tensor_stats({"t": {"dtype": "F8_E4M3", "shape": [4]}})["dtype"] == "fp8 (e4m3)"
    # Unknown dtype code surfaces verbatim; no tensors -> {}.
    assert pack._tensor_stats({"t": {"dtype": "WAT", "shape": [2]}})["dtype"] == "WAT"
    assert pack._tensor_stats({"__metadata__": {"a": "b"}}) == {}


def test_friendly_base_maps_known_architectures():
    assert pack._friendly_base("stable-diffusion-xl-v1-base/lora") == "SDXL"
    assert pack._friendly_base(None, "sdxl_base_v1-0") == "SDXL"
    assert pack._friendly_base("flux-1-dev") == "Flux.1"
    assert pack._friendly_base(None, "sd_v1") == "SD 1.5"


def test_friendly_base_falls_back_to_raw_then_none():
    assert pack._friendly_base("some-future-model") == "some-future-model"
    assert pack._friendly_base(None, None) is None


def test_top_tags_aggregates_and_sorts_by_frequency():
    raw = json.dumps({"ds1": {"cat": 3, "dog": 1}, "ds2": {"dog": 5, "  ": 9}})
    # dog 6 > cat 3; the whitespace-only tag is dropped.
    assert pack._top_tags(raw) == ["dog", "cat"]


def test_top_tags_empty_on_malformed():
    assert pack._top_tags("not json") == []
    assert pack._top_tags(None) == []
    assert pack._top_tags(json.dumps(["not", "a", "dict"])) == []


def test_curate_metadata_pulls_high_signal_keys():
    out = pack._curate_metadata(
        {
            "modelspec.architecture": "stable-diffusion-xl-v1-base/lora",
            "modelspec.title": "My LoRA",
            "ss_network_module": "networks.lora",
            "ss_network_dim": "32",
            "ss_network_alpha": "16",
            "ss_tag_frequency": json.dumps({"d": {"trigger_word": 10}}),
        }
    )
    assert out["base"] == "SDXL"
    assert out["title"] == "My LoRA"
    assert out["rank"] == "32"
    assert out["alpha"] == "16"
    assert out["tags"] == ["trigger_word"]


# ---------------------------------------------------------------------------
# /model_gallery/meta endpoint
# ---------------------------------------------------------------------------


def test_meta_missing_params_is_400():
    assert _call(pack.model_meta).status == 400
    assert _call(pack.model_meta, category="loras").status == 400


def test_meta_unknown_category_is_400():
    resp = _call(pack.model_meta, category="../../etc", name="x.safetensors")
    assert resp.status == 400
    assert "unknown category" in resp.json_body["error"]


def test_meta_not_found_is_404():
    folder_paths.get_full_path = lambda category, name: None
    resp = _call(pack.model_meta, category="loras", name="missing.safetensors")
    assert resp.status == 404
    assert resp.json_body["ok"] is False


def test_meta_unsupported_format_reports_supported_false(tmp_path):
    f = tmp_path / "upscaler.pth"
    f.write_bytes(b"\x00")
    folder_paths.get_full_path = lambda category, name: str(f)
    resp = _call(pack.model_meta, category="upscale_models", name="upscaler.pth")
    assert resp.status == 200
    assert resp.json_body["ok"] is True
    assert resp.json_body["supported"] is False
    assert resp.json_body["meta"] == {}


def test_meta_returns_curated_metadata_for_safetensors(tmp_path):
    pack._META_CACHE.clear()
    f = tmp_path / "lora.safetensors"
    _write_safetensors(
        f,
        {
            "__metadata__": {
                "modelspec.architecture": "stable-diffusion-xl-v1-base/lora",
                "ss_network_dim": "64",
            }
        },
    )
    folder_paths.get_full_path = lambda category, name: str(f)
    resp = _call(pack.model_meta, category="loras", name="lora.safetensors")
    assert resp.status == 200
    assert resp.json_body["supported"] is True
    assert resp.json_body["meta"]["base"] == "SDXL"
    assert resp.json_body["meta"]["rank"] == "64"
    # Size is always injected from the stat that keys the cache.
    assert resp.json_body["meta"]["size"] == f.stat().st_size


def test_meta_includes_dtype_and_params(tmp_path):
    pack._META_CACHE.clear()
    f = tmp_path / "model.safetensors"
    _write_safetensors(
        f,
        {
            "__metadata__": {"modelspec.architecture": "flux-1-dev"},
            "blk.0": {"dtype": "F8_E4M3", "shape": [100, 100]},  # 10_000 elems
            "blk.1": {"dtype": "BF16", "shape": [10, 10]},  # 100 elems
        },
    )
    folder_paths.get_full_path = lambda category, name: str(f)
    resp = _call(pack.model_meta, category="diffusion_models", name="model.safetensors")
    meta = resp.json_body["meta"]
    assert meta["dtype"] == "fp8 (e4m3)"  # dominant by element count
    assert meta["params"] == 10_100
    assert meta["base"] == "Flux.1"


def test_meta_caches_on_path_mtime_size(tmp_path):
    pack._META_CACHE.clear()
    f = tmp_path / "cached.safetensors"
    _write_safetensors(f, {"__metadata__": {"ss_network_dim": "8"}})
    folder_paths.get_full_path = lambda category, name: str(f)

    _call(pack.model_meta, category="loras", name="cached.safetensors")
    keys = list(pack._META_CACHE)
    assert len(keys) == 1
    # Second call hits the cache (no new entry, same curated result).
    resp = _call(pack.model_meta, category="loras", name="cached.safetensors")
    assert list(pack._META_CACHE) == keys
    assert resp.json_body["meta"]["rank"] == "8"


# ---------------------------------------------------------------------------
# /model_gallery/hash endpoint
# ---------------------------------------------------------------------------


def test_hash_missing_params_is_400():
    assert _call(pack.model_hash).status == 400
    assert _call(pack.model_hash, category="loras").status == 400


def test_hash_unknown_category_is_400():
    resp = _call(pack.model_hash, category="../../etc", name="x.safetensors")
    assert resp.status == 400
    assert "unknown category" in resp.json_body["error"]


def test_hash_not_found_is_404():
    folder_paths.get_full_path = lambda category, name: None
    resp = _call(pack.model_hash, category="loras", name="missing.safetensors")
    assert resp.status == 404


def test_hash_computes_full_file_digest(tmp_path):
    import hashlib

    pack._HASH_CACHE.clear()
    f = tmp_path / "plain.ckpt"  # non-safetensors -> no embedded hash, must compute
    payload = b"the quick brown fox"
    f.write_bytes(payload)
    folder_paths.get_full_path = lambda category, name: str(f)
    resp = _call(pack.model_hash, category="checkpoints", name="plain.ckpt")
    assert resp.status == 200
    assert resp.json_body["source"] == "computed"
    assert resp.json_body["sha256"] == hashlib.sha256(payload).hexdigest()


def test_hash_prefers_embedded_digest(tmp_path):
    pack._META_CACHE.clear()
    sha = "a" * 64
    f = tmp_path / "signed.safetensors"
    _write_safetensors(f, {"__metadata__": {"modelspec.hash_sha256": sha}})
    folder_paths.get_full_path = lambda category, name: str(f)
    resp = _call(pack.model_hash, category="loras", name="signed.safetensors")
    assert resp.status == 200
    assert resp.json_body["source"] == "embedded"
    assert resp.json_body["sha256"] == sha


def test_hash_caches_computed_digest(tmp_path):
    pack._HASH_CACHE.clear()
    f = tmp_path / "cacheme.ckpt"
    f.write_bytes(b"data")
    folder_paths.get_full_path = lambda category, name: str(f)
    _call(pack.model_hash, category="checkpoints", name="cacheme.ckpt")
    keys = list(pack._HASH_CACHE)
    assert len(keys) == 1
    _call(pack.model_hash, category="checkpoints", name="cacheme.ckpt")
    assert list(pack._HASH_CACHE) == keys  # no new entry


# ---------------------------------------------------------------------------
# Frontend ↔ backend category-gate consistency
# ---------------------------------------------------------------------------
#
# The frontend maps widget names to folder_paths categories in
# src/model-gallery.ts; the backend gates ?category= on KNOWN_CATEGORIES.
# If a category the frontend can request is missing from the backend gate, a
# legitimate widget silently 400s. This parses the categories out of the TS
# source (import-light — no JS execution) and asserts the gate covers them.


def _frontend_categories() -> set[str]:
    """Extract the category strings from the WIDGET_CATEGORY Map literal."""
    # The TS source declares the map as `new Map<string, string>([` — match
    # the declaration up to the opening array bracket.
    start = re.search(r"const WIDGET_CATEGORY = new Map(?:<[^>]*>)?\(\[", JS_SRC).start()
    end = JS_SRC.index("]);", start)
    block = JS_SRC[start:end]
    # Each entry is ["widget_name", "category"] — the second quoted string.
    return set(re.findall(r'\[\s*"[^"]+"\s*,\s*"([^"]+)"\s*\]', block))


def test_every_frontend_category_is_in_the_backend_gate():
    fe = _frontend_categories()
    # Sanity: the parser actually found the map (not an empty set).
    assert "loras" in fe
    assert "checkpoints" in fe
    missing = fe - pack.KNOWN_CATEGORIES
    assert not missing, f"frontend categories not gated by KNOWN_CATEGORIES: {missing}"


def test_known_categories_are_all_nonempty_strings():
    assert pack.KNOWN_CATEGORIES, "KNOWN_CATEGORIES must not be empty"
    for cat in pack.KNOWN_CATEGORIES:
        assert isinstance(cat, str) and cat
