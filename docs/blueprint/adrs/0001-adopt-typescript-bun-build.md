---
id: ADR-0001
date: 2026-06-06
status: Accepted
deciders: Lauri Gates
domain: build-tooling
supersedes: []
relates-to: []
github-issues: []
name: blueprint-derive-adr
---

# ADR-0001: Adopt TypeScript + bun build for the frontend extension

## Status note

This pack shipped its frontend as hand-served vanilla ES modules
(`web/js/model-gallery.js` + `web/js/model-corpus.js`, plus the vendored
`web/js/modal-shell.js` / `web/js/modal-fuzzy.js`), per the original
`docs/IMPLEMENTATION-PLAN.md` "established pattern" — no build step, relative
`../../../scripts/app.js` import, copied modal primitives. That no-bundler /
multi-file-JS approach is **superseded** by this ADR. (No prior ADR recorded
it formally; this ADR is the first design record for the pack.)

## Decision Drivers

- The extension reaches deep into the minified ComfyUI frontend's LiteGraph
  widget/node objects (`widget.onPointerDown`, `widget.callback`,
  `node.widgets`, `app.graph._nodes`, `widget.options.values`). Those accesses
  are exactly where a frontend-version bump silently breaks the pack (the
  "Frontend hook is version-sensitive" hard rule). Type checking against
  `@comfyorg/comfyui-frontend-types` turns a class of those breakages into
  compile errors.
- A bun-externalization spike confirmed the toolchain keeps the
  zero-runtime-bundle property: `bun build ./src/model-gallery.ts --target
  browser --format esm --outdir web/dist --external '/scripts/*'` emits
  browser-clean ESM with the `/scripts/app.js` runtime import left
  **unbundled** (resolved at runtime against ComfyUI's served module). The
  browser still loads a plain ES module, ComfyUI still serves it as a static
  file — now with a typed source.
- The pack already carried a `package.json` + a Vitest dev dependency, so the
  "no `package.json` / no `node_modules`" premise no longer held. Adding a
  build step on top of an existing dev toolchain is a small delta.
- The vendored `modal-shell.js` / `modal-fuzzy.js` copies were always intended
  for extraction into a shared lib. That lib now exists as
  `@laurigates/comfy-modal-kit`; consuming it deletes the two vendored files
  and removes the copy-drift risk.

## Considered Options

1. **TypeScript source in `src/`, built to `web/dist/` via `bun build`,
   consuming `@laurigates/comfy-modal-kit`** — typed authoring, browser-ESM
   output, `/scripts/*` externalized, kit inlined.
2. **Stay on multi-file vanilla JS** — no build, no types, vendored modal
   copies kept in lockstep by hand.
3. **TypeScript with `tsc` emit instead of `bun build`** — `tsc` can emit ESM
   but does not understand the `--external '/scripts/*'` runtime-import concept
   and would not keep the served-path import unbundled cleanly; it is a type
   checker first, a bundler never.

## Decision Outcome

**Chosen option**: TypeScript source in `src/`, built to `web/dist/` via
`bun build`, consuming `@laurigates/comfy-modal-kit`. The spike proved the
output preserves the runtime contract, and the type checker pays for itself at
the frontend seam. `tsc --noEmit` is the type gate; `bun build` is the emit —
decoupled, each fast and single-purpose.

### Build & serve mechanics

- **Source**: `src/model-gallery.ts` (the entry — the module that calls
  `app.registerExtension`) + `src/model-corpus.ts` (pure corpus helpers) +
  `src/comfyui-shims.d.ts`.
- **Shared primitives**: `openModalShell`, `fuzzyRank`, `highlightMatches`
  imported from `@laurigates/comfy-modal-kit` (^0.2.0). `bun build` **inlines**
  the kit into the output bundle — it is NOT externalized — so a single static
  file ships. The vendored `web/js/modal-shell.js` and `web/js/modal-fuzzy.js`
  are deleted.
- **Type gate**: `bun run typecheck` → `tsc --noEmit` against
  `@comfyorg/comfyui-frontend-types`.
- **Emit**: `bun run build` →
  `bun build ./src/model-gallery.ts --target browser --format esm --outdir
  web/dist --external '/scripts/*'`, then copies `web/data/` → `web/dist/data/`.
- **Serve**: `__init__.py` sets `WEB_DIRECTORY = "./web/dist"`. ComfyUI serves
  that tree at `/extensions/comfyui-model-gallery/`, so the built JS is at
  `/extensions/comfyui-model-gallery/model-gallery.js` and the corpus at
  `/extensions/comfyui-model-gallery/data/models.json`. `EXT_NAME` and the
  `/model_gallery/` endpoint URLs are unchanged — the fetch paths derive from
  the pack directory name, not the JS file location.
- **Distribution**: `web/dist/` is git-ignored (it is generated). The Comfy
  Registry tarball includes it via `[tool.comfy] includes = ["web/dist"]`, and
  CI (`publish.yml`) runs `bun install && bun run build` before
  `publish-node-action` so the artifact exists at publish time.

### Type-seam notes (for future maintainers)

- `@comfyorg/comfyui-frontend-types` exports `ComfyApp` (which types the
  imported `app` via `src/comfyui-shims.d.ts`) but **not** `LGraphNode` / the
  widget interfaces (declared internally, un-exported). The pack models the
  small surface it touches with local structural interfaces (`ModelWidget`,
  `ModelNode`, `ListingItem`, `FileMeta`) rather than importing un-exportable
  types.
- TypeScript will not match an ambient `declare module` against a rooted
  (`/scripts/app.js`) path specifier. A `paths` mapping in `tsconfig.json`
  points that import at `src/comfyui-shims.d.ts` for type resolution; the
  emitted import string stays `/scripts/app.js` and `--external '/scripts/*'`
  keeps it unbundled.

### Positive Consequences

- Static type checking at the version-sensitive frontend seam — the single
  largest source of silent breakage now has a compile-time gate.
- Output is still plain browser ESM served as a static file; no runtime
  bundler, no framework, no change to how ComfyUI loads the extension.
- The pure helpers keep their exact export names (`compileCorpus`, `safeRegex`,
  `corpusKey`, `lookup`, `corpusFields`, `formatTooltip`; and the picker's
  `categoryForWidget`, `isComboWidget`, `topLevelSubfolder`, `subfolderChips`,
  `basenameOf`, `remapMatches`, `WIDGET_CATEGORY`), so the Vitest suite imports
  the `.ts` source directly with no build dependency in tests.
- The vendored modal copies are gone — `@laurigates/comfy-modal-kit` is the one
  source of truth, eliminating copy drift.
- `knip` + `tsc` + Vitest + Biome give a complete local gate chain alongside
  the unchanged pytest backend suite.

### Negative Consequences

- The "edit → hard-refresh" loop now requires a `bun run build` step (the
  served file is `web/dist/model-gallery.js`, not the source). Mitigated by
  `just build` and a fast (~7ms) incremental build.
- A build artifact must be present for the screenshot pipeline and the registry
  publish; both are wired to build first, but a fresh checkout has no
  `web/dist/` until `bun run build` runs.
- One more dependency set (`typescript`, `@comfyorg/comfyui-frontend-types`,
  `knip`, `@laurigates/comfy-modal-kit`) and a `tsconfig.json` to maintain.

## Scope: backend untouched

This migration is frontend-only. `model_gallery.py` (the node + the
`/model_gallery/list` / `/meta` aiohttp endpoints) is unchanged except for a
comment pointer; `__init__.py` changed only `WEB_DIRECTORY`. The pytest backend
suite stays green.

## Links

- Bun externalization spike: `bun build ./src/model-gallery.ts --target browser
  --format esm --outdir web/dist --external '/scripts/*'` (PASSED — kit inlined,
  `/scripts/app.js` external)
- `CLAUDE.md` § "File layout", § "Dev workflow"
- `@laurigates/comfy-modal-kit` — the extracted modal primitives (formerly the
  vendored `modal-shell.js` / `modal-fuzzy.js`)
- Mirrors comfyui-sampler-info ADR-0010 (the pilot migration)

---
*Authored as part of the TypeScript + bun build migration.*
