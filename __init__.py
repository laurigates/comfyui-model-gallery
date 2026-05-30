"""Model Gallery for ComfyUI.

See model_gallery.py for the backend (node + HTTP endpoints) and
web/js/model-gallery.js for the frontend extension.
"""

try:
    # ComfyUI loads custom_nodes as packages — relative import works.
    from .model_gallery import NODE_CLASS_MAPPINGS, NODE_DISPLAY_NAME_MAPPINGS
except ImportError:
    # Pytest imports __init__.py without a package context; fall back to
    # absolute (the pack root is on sys.path via pyproject pythonpath).
    from model_gallery import NODE_CLASS_MAPPINGS, NODE_DISPLAY_NAME_MAPPINGS

WEB_DIRECTORY = "./web"

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS", "WEB_DIRECTORY"]
