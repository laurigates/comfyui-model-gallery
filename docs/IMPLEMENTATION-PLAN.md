# comfyui-model-gallery — implementation plan

*Derived from the brainstorm report
`/Users/lgates/repos/laurigates/comfyui-node-ideas.md` (candidate
`comfyui-model-gallery`, rank #2). The direct application of gallery-loader's
card-grid + thumbnail-backend template to the 47 folder-backed model combos.*

## The pain

All 47 `folder_paths.get_filename_list(...)` combos — `lora_name`, `ckpt_name`,
`vae_name`, `control_net_name`, `unet_name`, `clip_name*`, `style_model_name`,
`gligen_name`, `upscale_model`, `clip_vision_name`, … — render as the same
single-column, alphabetical, unsearchable native LiteGraph dropdown that
mispositions on a zoomed/panned canvas and is effectively unusable on touch for
folders with >20 entries (LoRAs routinely number 1000+ in deep subfolders with
cryptic names). Every existing model picker is a *replacement node* or a
*separate panel/page*, desktop-hover oriented. **None improves the native combo
in place, additively, mobile-first.**

## Target widgets

Detected by widget **name** (a stable set covering folder-backed loaders,
generic across node packs): `lora_name`, `ckpt_name`, `vae_name`,
`control_net_name`, `unet_name`, `clip_name`, `clip_name1`, `clip_name2`,
`clip_name3`, `clip_name4`, `style_model_name`, `gligen_name`, `upscale_model`,
`clip_vision_name`, `hypernetwork_name`, `photomaker_model_name`, `model_name`.

## Approach (established pattern + thin backend)

`app.registerExtension` → `nodeCreated` + `loadedGraphNode` → wrap
`onPointerDown` on matched combos → open a centered HTML modal via
`openModalShell`: 16px fuzzy input (`fuzzyRank` from the copied
`modal-fuzzy.js`), big **card grid**, momentum scroll, **subfolder filter
chips**, mtime/name sort. Write the exact combo string back through
`widget.value`.

### Backend (`model_gallery.py`) — ComfyUI-bundled libs only

Mirror gallery-loader's thumb-server. Endpoints under `/model_gallery/`:

| Endpoint | Purpose |
|----------|---------|
| `/list` | Enumerate a `folder_paths` category (the widget's combo source) with mtime + subfolder; flag which entries have a sibling preview. |
| `/thumb` | Serve the Civitai-style sibling `.png`/`.jpeg`/`.webp` that sits next to a `.safetensors` (resized webp). |

**Security perimeter:** `/thumb` reads a path off disk → it MUST gate on the
`ALLOWED_EXTENSIONS` whitelist (already stubbed in `model_gallery.py`). Widen
the whitelist explicitly for any new preview format; never read an arbitrary
absolute path without the gate.

## Mobile benefit

Combos are the most common widget on nearly every node — this is the
highest-frequency touch unlock, in place on the user's real desktop graph, with
no node-swapping and no whole-frontend replacement.

## Differs from existing packs

rgthree Power Lora Loader, ComfyUI-Lora-Manager, JNodes, pysssss Custom-Scripts
all do LoRA/checkpoint previews — but as replacement nodes or separate
panels/pages, desktop-hover oriented, legacy LiteGraph. This is the additive,
mobile-first, widget-name-keyed application of gallery-loader's proven DNA to
the model combos none of them touch in place. **Do not rebuild their metadata**
— the gap is purely the in-place mobile-first picker UX.

## Critical guardrails

- **Value contract — don't churn workflows.** Write back the *exact* combo
  string the native dropdown would (the bare filename, including subfolder as
  the registry expects). Do not re-encode or normalize — serialized workflows
  would churn on save/reload.
- **Defer to native search on new frontends.** Frontends ≥ ~1.45 add a built-in
  combo search; detect and defer rather than fight it (the touch card grid is
  still the win on mobile — gate the interception on a touch/coarse-pointer
  media query if the native search is adequate on desktop).
- **No non-bundled Python deps.** Backend uses `aiohttp` + `folder_paths` +
  `server` only; thumbnail resize via the bundled Pillow.

## Milestones

1. **v0.1 — picker, no thumbnails.** `/list` + fuzzy card grid (names only) +
   subfolder chips over the full widget set. Already a large touch win.
2. **v0.2 — sibling preview thumbnails.** `/thumb` + card images for entries
   that have a Civitai-style sibling image.
3. **v0.3 — sort + recents.** mtime/name sort toggle; recently-picked section.
4. **v0.4 — fold in `LoadImageOutput`?** No — that belongs in gallery-loader
   (taskwarrior 156). Keep this pack to model combos.

## Open decisions

- **Per-file metadata badges** (base-model SD1.5/SDXL/Flux tags) — out of scope
  here; they need safetensors-header reads. If wanted, add to *this* backend
  (it already has a Python server) rather than the frontend-only `model-info`
  idea. Decide after v0.2.
- **Subfolder model**: flat fuzzy over full relative paths vs. drill-down
  chips. Start with fuzzy-over-full-path + optional top-level chips.
- **Thumbnail cache**: on-the-fly resize vs. a cached webp dir. Start
  on-the-fly (gallery-loader pattern); add a cache only if slow.

## References

- Brainstorm report: `../comfyui-node-ideas.md` (row: model-gallery #2).
- Backend + value-contract + whitelist reference: `../comfyui-gallery-loader`
  (`gallery_loader.py`, `.claude/rules/api-conventions.md`).
- Combo sources: ComfyUI `nodes.py` (`folder_paths.get_filename_list`), `folder_paths.py`.
- taskwarrior: `project:comfyui-nodes` task 153.
