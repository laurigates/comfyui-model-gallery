"""Model Gallery for ComfyUI.

See model_gallery.py for the backend (node + HTTP endpoints). The frontend
extension is authored in TypeScript (src/model-gallery.ts) and compiled to
ESM via `bun build`, emitted to web/dist/ (the corpus JSON is copied there
too). ComfyUI serves WEB_DIRECTORY as the extension root. See ADR-0001.
"""

try:
    # ComfyUI loads custom_nodes as packages — relative import works.
    from .model_gallery import NODE_CLASS_MAPPINGS, NODE_DISPLAY_NAME_MAPPINGS
except ImportError:
    # Pytest imports __init__.py without a package context; fall back to
    # absolute (the pack root is on sys.path via pyproject pythonpath).
    from model_gallery import NODE_CLASS_MAPPINGS, NODE_DISPLAY_NAME_MAPPINGS

WEB_DIRECTORY = "./web/dist"

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS", "WEB_DIRECTORY"]
