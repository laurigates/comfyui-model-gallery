# CLAUDE.md

ComfyUI custom-node pack with a thin Python backend (a node + HTTP endpoints
in `model_gallery.py`) and a TypeScript frontend extension compiled to browser
ESM via `bun build` (see ADR-0001).

## The pattern ("the vein")

A mobile-first ComfyUI usability pack: a frontend extension that intercepts a
widget interaction (`widget.onPointerDown`, modern Vue frontend) and opens a
touch-friendly HTML modal in place of a clunky native LiteGraph control.
Widgets are matched **by name** (generic across node packs), the enhancement is
**additive** (graceful fallback to the native control, never breaks serialized
workflows), and the modal is **touch-first** (16px inputs to avoid iOS zoom,
big tap targets, momentum scroll). The shared modal primitives
(`openModalShell` / `closeModalShell`, `fuzzyScore` / `fuzzyRank` /
`highlightMatches`) come from **`@laurigates/comfy-modal-kit`** — `bun build`
inlines the kit into the shipped bundle (formerly the vendored
`modal-shell.js` / `modal-fuzzy.js`, now deleted).

## Architecture Decisions

| ID | Title | Domain |
|----|-------|--------|
| [ADR-0001](docs/blueprint/adrs/0001-adopt-typescript-bun-build.md) | Adopt TypeScript + bun build for the frontend extension (supersedes the original no-bundler / multi-file-JS approach) | build-tooling |

## File layout

| Path | Purpose |
|------|---------|
| `__init__.py` | Loader stub. Imports node mappings from the backend module; exports `WEB_DIRECTORY = "./web/dist"`. |
| `model_gallery.py` | Node + HTTP endpoints (`/list`, `/meta`, `/thumb` stub). Bundled libs only; arbitrary-path endpoints gate on an extension whitelist; `/meta` resolves paths only via `folder_paths`. **Unchanged by the TS migration.** |
| `src/model-gallery.ts` | The extension entry — TypeScript source (port of the former `web/js/model-gallery.js`). Widget interception + modal + corpus/metadata annotation. Compiled to `web/dist/model-gallery.js`. |
| `src/model-corpus.ts` | Pure corpus helpers (`compileCorpus`/`safeRegex`/`corpusKey`/`lookup`/`corpusFields`/`formatTooltip`). Filename → model info. Imported by the entry; bundled in. |
| `src/comfyui-shims.d.ts` | Types the `/scripts/app.js` runtime import (see ADR-0001 type-seam notes). |
| `web/dist/` | **Generated** — `bun build` output (`model-gallery.js` + copied `data/`). Git-ignored; force-shipped to the registry via `[tool.comfy] includes`. Do not edit by hand. |
| `web/data/models.json` | The model corpus: base-architecture families + notable models, matched by filename pattern. Data-only; edit to extend coverage. Copied into `web/dist/data/` at build. |
| `pyproject.toml` | Comfy Registry metadata. `PublisherId` + `version` + `[tool.comfy] includes = ["web/dist"]`. |
| `tsconfig.json` | TypeScript config — strict, `tsc --noEmit` type gate, `/scripts/app.js` paths shim. |
| `knip.json` | Dead-code / unused-dependency check config (entry: `src/model-gallery.ts`). |
| `biome.json` | Biome (TS/JSON) linter + formatter config. |
| `package.json` | Dev toolchain + the `@laurigates/comfy-modal-kit` runtime dep — `bun build`, `tsc`, Vitest, Biome, knip. |
| `.github/workflows/` | `ci.yml` (ruff/biome/typecheck+build/pytest/vitest/knip/gitleaks), `publish.yml` (bun build then auto-publish on version bump), `release-please.yml`. |
| `tests/` | pytest backend suite. `tests/js/` Vitest suite for the pure TS helpers (imports `src/*.ts`). |
| `justfile` | `lint`, `format`, `typecheck`, `build`, `knip`, `test`, `check` recipes — the local CI gate. |

## Hard rules

- **Pack directory name is part of the URL.** The built `web/dist/model-gallery.js`
  is served at `/extensions/comfyui-model-gallery/model-gallery.js` and the
  corpus at `/extensions/comfyui-model-gallery/data/models.json`. Renaming the
  pack dir breaks every fetch. If unavoidable, sync `EXT_NAME` in `src/model-gallery.ts`.
- **No new Python dependencies. Backend uses ComfyUI-bundled libs only (aiohttp, folder_paths, server). A feature needing another lib → a separate companion pack.**
- **Additive only.** Never clobber an existing tooltip/control; fall back to
  the native widget when there's no match. Never fabricate data.
- **Frontend hook is version-sensitive.** The modal opens via
  `widget.onPointerDown`. Keep an explicit button-widget fallback (Strategy
  B) if you depend on the modal being reachable.
- **Don't externalize the modal kit.** `@laurigates/comfy-modal-kit` must be
  **inlined** by `bun build` (only `/scripts/*` is externalized). A single
  static file ships.

## Dev workflow

```sh
uv sync --group dev          # ruff, pytest, pre-commit
bun install                  # TS toolchain + the modal kit (typescript, types, vitest, biome, knip)
pre-commit install
bun run build                # compile src/ -> web/dist/ (+ copy corpus)
just check                   # lint + typecheck + build + knip + test — the local CI gate
```

The served file is `web/dist/model-gallery.js` — `web/dist/` is git-ignored and
generated. **After editing `src/*.ts` you must `bun run build`** before
hard-refreshing the tab. No ComfyUI restart needed for frontend changes.
Changes to `model_gallery.py` (backend) DO require a ComfyUI restart.

### Gates before commit

```sh
bun run typecheck            # tsc --noEmit
bun run build                # emit web/dist/
bunx biome check .
bun run knip
bun run test                 # Vitest (imports src/*.ts)
uv run pytest -v             # backend suite
```

### Endpoint reachability check

```sh
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:8188/extensions/comfyui-model-gallery/model-gallery.js
```

## Releases

Bump `version` in `pyproject.toml` and push to `main` →
`Comfy-Org/publish-node-action` publishes to the Comfy Registry. Requires
the `REGISTRY_ACCESS_TOKEN` repo secret. Use conventional commits;
release-please maintains `CHANGELOG.md` and the version bump PR.
