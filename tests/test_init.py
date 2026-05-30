"""Sanity checks for the loader stub.

``__init__.py`` is checked as source text (its relative import would
require packaging the pack dir, which isn't worth the ceremony for a
re-export shim — mirrors the gallery-loader convention). The backend's
node mappings are imported directly and asserted on; conftest.py stubs
the ComfyUI internals so the import works in a vanilla environment.
"""

import pathlib

import model_gallery as pack

ROOT = pathlib.Path(__file__).resolve().parent.parent
INIT_SRC = (ROOT / "__init__.py").read_text()


def test_init_declares_web_directory_pointing_at_web():
    assert 'WEB_DIRECTORY = "./web"' in INIT_SRC


def test_init_reexports_node_mappings():
    # Mappings come from model_gallery; __init__ just re-exports them.
    assert "NODE_CLASS_MAPPINGS" in INIT_SRC
    assert "NODE_DISPLAY_NAME_MAPPINGS" in INIT_SRC


def test_init_includes_web_directory_in_all():
    assert '"WEB_DIRECTORY"' in INIT_SRC


def test_backend_exports_node_mappings():
    assert isinstance(pack.NODE_CLASS_MAPPINGS, dict)
    assert isinstance(pack.NODE_DISPLAY_NAME_MAPPINGS, dict)
    assert "ModelGallery" in pack.NODE_CLASS_MAPPINGS
