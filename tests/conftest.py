"""Stub ComfyUI-internal and unavailable imports so model_gallery.py can be
imported in a vanilla Python environment for unit tests.

Stubbed:
- aiohttp — not a ComfyUI-bundled dep in the CI runner.
- folder_paths, server — ComfyUI internals only present inside a ComfyUI
  install.

The PromptServer.instance.routes.get(path) decorator is wired explicitly so
the module-level @decorator calls in model_gallery return their wrapped
function unchanged (tests then call those coroutines directly with a fake
request).
"""

from __future__ import annotations

import sys
from types import ModuleType, SimpleNamespace
from unittest.mock import MagicMock


class _StubModule(ModuleType):
    def __getattr__(self, attr: str):
        if attr.startswith("__"):
            raise AttributeError(attr)
        m = MagicMock()
        setattr(self, attr, m)
        return m


def _ensure_stub(name: str) -> ModuleType:
    if name in sys.modules and not isinstance(sys.modules[name], _StubModule):
        return sys.modules[name]
    m = _StubModule(name)
    sys.modules[name] = m
    return m


# aiohttp — model_gallery uses `from aiohttp import web`. Provide a `web`
# submodule with a real json_response/Request/Response so endpoint tests can
# assert on the returned objects.
_aiohttp = _ensure_stub("aiohttp")
_web = _ensure_stub("aiohttp.web")


class _Response:
    def __init__(self, *, body=None, status=200, content_type=None, headers=None):
        self.body = body
        self.status = status
        self.content_type = content_type
        self.headers = headers or {}


class _JsonResponse(_Response):
    def __init__(self, data, *, status=200):
        super().__init__(body=data, status=status, content_type="application/json")
        self.json_body = data


def _json_response(data, *, status=200):
    return _JsonResponse(data, status=status)


class _Request:
    """Minimal aiohttp.web.Request stand-in: only .rel_url.query is used."""

    def __init__(self, query=None):
        self.rel_url = SimpleNamespace(query=dict(query or {}))


_web.json_response = _json_response
_web.Response = _Response
_web.Request = _Request
_aiohttp.web = _web

# ComfyUI internals
_ensure_stub("folder_paths")
_server = _ensure_stub("server")


class _NoopRoutes:
    """Decorator-shaped no-op for @PromptServer.instance.routes.get(path)."""

    def get(self, path):
        def deco(fn):
            return fn

        return deco

    def post(self, path):
        return self.get(path)


_server.PromptServer = SimpleNamespace(instance=SimpleNamespace(routes=_NoopRoutes()))
