# CLAUDE.md

ComfyUI custom-node pack with a thin Python backend (a node + HTTP endpoints in `model_gallery.py`) and a JS frontend extension.

## The pattern ("the vein")

A mobile-first ComfyUI usability pack: a frontend JS extension that
intercepts a widget interaction (`widget.onPointerDown`, modern Vue
frontend) and opens a touch-friendly HTML modal in place of a clunky
native LiteGraph control. Widgets are matched **by name** (generic across
node packs), the enhancement is **additive** (graceful fallback to the
native control, never breaks serialized workflows), and the modal is
**touch-first** (16px inputs to avoid iOS zoom, big tap targets, momentum
scroll). Reuses `modal-shell.js` (`openModalShell` / `closeModalShell`)
and `modal-fuzzy.js` (`fuzzyScore` / `fuzzyRank` / `highlightMatches`).

## File layout

| Path | Purpose |
|------|---------|
| `__init__.py` | Loader stub. Imports node mappings from the backend module; exports `WEB_DIRECTORY`. |
| `model_gallery.py` | Node + HTTP endpoints (`/list`, `/meta`, `/thumb` stub). Bundled libs only; arbitrary-path endpoints gate on an extension whitelist; `/meta` resolves paths only via `folder_paths`. |
| `web/js/model-gallery.js` | The extension: widget interception + modal + corpus/metadata annotation. |
| `web/js/model-corpus.js` | Pure corpus helpers (`compileCorpus`/`safeRegex`/`lookup`/`corpusFields`/`formatTooltip`). Filename → model info. |
| `web/data/models.json` | The model corpus: base-architecture families + notable models, matched by filename pattern. Data-only; edit to extend coverage. |
| `web/js/modal-shell.js` | Reusable modal dialog (copied from gallery-loader). |
| `web/js/modal-fuzzy.js` | fzf-lite fuzzy matcher (copied from gallery-loader). |
| `pyproject.toml` | Comfy Registry metadata. `PublisherId` + `version` are the fields you touch. |
| `.github/workflows/` | `ci.yml` (ruff/biome/pytest/vitest/gitleaks), `publish.yml` (auto-publish on version bump), `release-please.yml`. |
| `tests/` | pytest backend suite. `tests/js/` Vitest suite for pure JS helpers. |
| `justfile` | `lint`, `format`, `test`, `check` recipes — the local CI gate. |

## Hard rules

- **Pack directory name is part of the URL.** `web/js/model-gallery.js` is
  served at `/extensions/comfyui-model-gallery/js/model-gallery.js`. Renaming the pack dir
  breaks every fetch. If unavoidable, sync `EXT_NAME` in the JS.
- **No new Python dependencies. Backend uses ComfyUI-bundled libs only (aiohttp, folder_paths, server). A feature needing another lib → a separate companion pack.**
- **Additive only.** Never clobber an existing tooltip/control; fall back to
  the native widget when there's no match. Never fabricate data.
- **Frontend hook is version-sensitive.** The modal opens via
  `widget.onPointerDown`. Keep an explicit button-widget fallback (Strategy
  B) if you depend on the modal being reachable.

## Dev workflow

```sh
uv sync --group dev          # ruff, pytest, pre-commit
npm install --no-audit --no-fund   # Vitest (dev-only; nothing ships from node_modules)
pre-commit install
just check                   # lint + test — the local CI gate
```

Iterating on JS/CSS/JSON needs **no ComfyUI restart** — hard-refresh the tab.
Changes to `model_gallery.py` (backend) DO require a ComfyUI restart.

### Endpoint reachability check

```sh
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:8188/extensions/comfyui-model-gallery/js/model-gallery.js
```

## Releases

Bump `version` in `pyproject.toml` and push to `main` →
`Comfy-Org/publish-node-action` publishes to the Comfy Registry. Requires
the `REGISTRY_ACCESS_TOKEN` repo secret. Use conventional commits;
release-please maintains `CHANGELOG.md` and the version bump PR.
