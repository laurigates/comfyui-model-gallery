---
id: ADR-0002
date: 2026-07-02
status: Accepted
deciders: Lauri Gates
domain: api-design
supersedes: []
relates-to: [ADR-0001]
github-issues: [37]
name: adopt-field-provider-and-click-coordinator
---

# ADR-0002: Register a model-combo field provider & adopt the kit click coordinator

## Status note

This builds on ADR-0001 (TypeScript + `bun build`, consuming
`@laurigates/comfy-modal-kit`). It records adopting the kit's **v0.4.0**
cross-pack field-provider registry and click coordinator, decided upstream in
the kit's **ADR-0001** (`cross-pack-field-provider-and-click-coordination`) —
the shared design this pack now implements as a *provider*. Nothing in ADR-0001
(build/serve mechanics, the additive/value-contract rules) is superseded.

## Decision Drivers

- **The packs don't compose.** Before v0.4.0 this pack could only surface its
  gallery by intercepting `widget.onPointerDown` on the canvas. An all-fields
  editor built on the kit (`comfyui-prompt-editor`) renders a bare `<select>`
  for a `ckpt_name` combo even when this pack — which owns a far richer
  affordance for exactly that widget — is installed. The richer control was
  unreachable from inside the editor.
- **This pack already has the exact match predicate a provider needs.** Model
  combos are detected **by widget name** through `WIDGET_CATEGORY` /
  `categoryForWidget`, gated by the `isComboWidget` `options.values`-array
  guard. That is precisely the `match(widget)` a `FieldProvider` requires, so
  exposing the gallery inline is a small delta, not new detection logic.
- **Every pack hand-rolls the same pointer wrapper.** The bespoke
  "chain the original `onPointerDown`, honor its consumed-return, fall back to
  native on error" block is copy-pasted and subtly divergent across packs, and
  an open modal cannot veto a sibling's canvas gesture. The kit's
  `patchWidgetPointer` + shared active-modal slot is the single coordination
  point.

## Considered Options

1. **Register a `FieldProvider` returning an inline `FieldControl`, and adopt
   `patchWidgetPointer` for the canvas intercept.** The provider exposes the
   gallery as a mountable inline element with value accessors; the editor
   mounts it in the field row and commits `getValue()` verbatim. The canvas
   path keeps its own modal, now opened through the shared coordinator.
2. **Open this pack's modal from inside the editor (a nested modal).** Stacks
   two backdrops and violates the single-active-modal invariant the kit exists
   to enforce — the exact bug the kit's ADR-0001 rejects.
3. **Direct pack-to-pack imports.** The editor `bun add`s this pack and calls
   in. Creates a dependency web, couples release cycles, and each pack still
   inlines its own kit copy, so the modal-stacking bug persists.
4. **Do nothing.** Cheap, but the gallery stays canvas-only and the packs
   remain non-composing.

## Decision Outcome

**Chosen option**: "Register a `FieldProvider` returning an inline
`FieldControl`, and adopt `patchWidgetPointer`". Implemented in
`src/model-gallery.ts`:

- **A shared inline gallery builder (`createGallery`)** — the card-grid gallery
  as a self-contained control (its own search box + chips + grid + count),
  decoupled from any modal. It returns a `GalleryView` with `getValue()` /
  `hasChanged()` / `focus()` / `destroy()` / `load()`. This is the
  onboarding-mandated split of the DOM builder from the self-committing modal
  wrapper.
- **The on-canvas path (`openPicker`)** now wraps a `createGallery` view inside
  `openModalShell`, wiring the shell's header search into the view and
  committing to the widget (`commitToWidget`) + closing on select. Because
  `openModalShell` registers itself with the coordinator's shared active-modal
  slot, opening it dismisses any sibling pack's modal.
- **The field provider** — `registerFieldProvider({ id:
  "comfyui-model-gallery:combo", priority: 10, match, create })`. `match`
  reuses `categoryForWidget(w) !== null && isComboWidget(w)`, so a `*_name`
  string widget that lacks a `values` array is left to the editor's built-in
  control. `create(ctx)` returns a `FieldControl` whose `el` is the inline
  gallery, `getValue()` returns the selected model name **verbatim** (the
  value contract from ADR-0001 — no re-encoding), `hasChanged()` compares
  against `ctx.initialValue`, and `destroy()` detaches listeners.
- **`patchWidgetPointer`** replaces the hand-rolled `enhanceNode`
  `onPointerDown` wrapper, preserving the additive/fallback contract (chain
  original → open picker → native fallback on error) while cooperating with the
  kit's coordination instead of consuming the event unilaterally.

### Constraint: inline control, not a nested modal

The editor mounts the provider's `el` **inline** in the field row and never
opens this pack's modal — there is only ever one modal (the editor). This keeps
the single-active-modal invariant intact, which is why `create()` returns a
mountable element + value accessors rather than an opener.

### Additive-fallback guarantee (unchanged from ADR-0001)

The provider is purely additive: if this pack isn't installed it never
registers, and a kit consumer that gets `null` from `resolveFieldProvider`
falls back to its built-in `<select>`. Standalone use (no editor) is unchanged
— the coordinator-driven pointer intercept still opens the full-screen gallery
on canvas tap.

### Positive Consequences

- The gallery composes: `comfyui-prompt-editor` surfaces it inline per model
  combo when this pack is present.
- The copy-pasted pointer wrapper is gone in favor of the shared
  `patchWidgetPointer`, and this pack now participates in the single-active
  modal discipline across packs.
- The value contract, name-based detection, and touch-first affordances are
  reused verbatim between the canvas and inline paths — one builder, two
  consumers.

### Negative Consequences

- The gallery UI now has two mount contexts (modal shell vs. inline field row),
  so the DOM builder must stay layout-neutral (it exposes its parts for the
  modal path to re-parent). A regression in one path can hide behind the other
  — both are exercised only in an integration environment.
- The pack depends on the kit's shared-global shape (`getKit()`), a cross-pack
  compatibility surface that must evolve additively (see kit ADR-0001).

## Links

- Kit ADR-0001 — `cross-pack-field-provider-and-click-coordination` (the
  upstream design this pack implements as a provider)
- Kit `docs/ONBOARDING.md` — provider registration + `patchWidgetPointer`
  adoption
- API: `registerFieldProvider({ id, priority?, match, create(ctx) →
  FieldControl })`, `FieldControl = { el, getValue, hasChanged, focus?,
  destroy? }`, `patchWidgetPointer`
- `src/model-gallery.ts` — `createGallery`, `openPicker`, `commitToWidget`, the
  provider registration, and the `patchWidgetPointer` intercept in `enhanceNode`
- ADR-0001 — the TypeScript + `bun build` decision this extends
- GitHub issue #37

---
*Authored alongside the field-provider adoption (kit v0.4.0).*
