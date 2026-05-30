"""Model Gallery — backend node + HTTP endpoints.

Uses ComfyUI-bundled libraries ONLY (aiohttp, plus folder_paths / server
from ComfyUI core). Do not add a Python dependency that ComfyUI does not
already ship; if a feature needs one, make it a separate companion pack.
"""

from __future__ import annotations

from aiohttp import web
from server import PromptServer

# Extensions this pack will read off disk. Any arbitrary-path endpoint MUST
# gate on this whitelist — never read an absolute path without checking.
ALLOWED_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp"}


@PromptServer.instance.routes.get("/model_gallery/list")
async def _list(request: web.Request) -> web.Response:
    """TODO: return the JSON listing the frontend modal renders.

    Mirror gallery-loader's /gallery_loader/list contract:
    success -> {"ok": True, "items": [...]} ; failure -> {"ok": False, ...}.
    """
    return web.json_response({"ok": True, "items": []})


class ModelGallery:
    """Minimal node stub. Replace inputs/outputs/FUNCTION with the real node,
    or delete this class if the pack is purely an interaction enhancer with
    no new node (then move the endpoints to a frontend-only companion)."""

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
