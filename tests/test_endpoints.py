"""Tests for the /model_gallery/list endpoint and its pure helpers.

folder_paths is stubbed in conftest.py; each test sets the specific
attributes it needs on the stub. Endpoint handlers are awaited directly with
a fake aiohttp request (also from conftest).
"""

from __future__ import annotations

import asyncio
import pathlib
import re

import folder_paths
from aiohttp.web import Request

import model_gallery as pack

ROOT = pathlib.Path(__file__).resolve().parent.parent
JS_SRC = (ROOT / "web" / "js" / "model-gallery.js").read_text()


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


def test_resolve_mtime_none_when_no_full_path():
    folder_paths.get_full_path = lambda category, name: None
    assert pack._resolve_mtime("loras", "missing.safetensors") is None


def test_resolve_mtime_returns_stat_mtime(tmp_path):
    f = tmp_path / "model.safetensors"
    f.write_bytes(b"x")
    folder_paths.get_full_path = lambda category, name: str(f)
    mtime = pack._resolve_mtime("loras", "model.safetensors")
    assert isinstance(mtime, float)
    assert mtime > 0


def test_resolve_mtime_none_on_stat_error():
    folder_paths.get_full_path = lambda category, name: "/no/such/file.safetensors"
    assert pack._resolve_mtime("loras", "model.safetensors") is None


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


def test_list_populates_mtime(tmp_path):
    f = tmp_path / "model.safetensors"
    f.write_bytes(b"x")
    folder_paths.get_filename_list = lambda category: ["model.safetensors"]
    folder_paths.get_full_path = lambda category, name: str(f)

    resp = _call(pack.model_list, category="checkpoints")
    item = resp.json_body["items"][0]
    assert isinstance(item["mtime"], float)


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
# Frontend ↔ backend category-gate consistency
# ---------------------------------------------------------------------------
#
# The frontend maps widget names to folder_paths categories in
# web/js/model-gallery.js; the backend gates ?category= on KNOWN_CATEGORIES.
# If a category the frontend can request is missing from the backend gate, a
# legitimate widget silently 400s. This parses the categories out of the JS
# source (import-light — no JS execution) and asserts the gate covers them.


def _frontend_categories() -> set[str]:
    """Extract the category strings from the WIDGET_CATEGORY Map literal."""
    start = JS_SRC.index("const WIDGET_CATEGORY = new Map([")
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
