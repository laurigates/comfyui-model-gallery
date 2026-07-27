---
id: ADR-0003
date: 2026-07-27
status: Accepted
deciders: Lauri Gates
domain: api-design
relates-to: [ADR-0002]
github-issues: []
name: register-model-picker-by-category
---

# ADR-0003: Register the Gallery as a Category-Keyed Model Picker

Consumer/provider mirror of **comfy-modal-kit ADR-0003**.

## Context

[ADR-0002](0002-adopt-field-provider-and-click-coordinator.md) registered this
pack's gallery as a kit `FieldProvider` — matched on a **widget**:

```ts
match: (w) => categoryForWidget(w) !== null && isComboWidget(w)
```

That predicate cannot reach rgthree's **Power Lora Loader**. Each LoRA row there
is a `type: "custom"` widget named `lora_1`, `lora_2`, … whose `value` is an
object (`{on, lora, strength, strengthTwo}`) with **no `options.values` array**,
so a row fails *both* halves: the name is not in `WIDGET_CATEGORY`, and there is
no values array. comfyui-prompt-editor consequently renders the LoRA filename as
a bare `<input type="text">` — hand-typing a `folder_paths` path on a phone,
which is the exact experience this pack exists to remove.

The kit's answer is a second registry keyed on the **`folder_paths` category**
rather than a widget (kit ADR-0003), because the host owns the row and wants only
the card grid.

## Decision Drivers

- **The gallery already returns the right shape.** `createGallery` yields
  `{el, getValue, hasChanged, focus, destroy, load}` — precisely what a
  `ModelPickerControl` is, and precisely what the existing `FieldProvider` wraps.
  Registering as a picker should be a *wrapper*, not a second implementation.
- **The value space is already identical.** rgthree enumerates LoRAs via
  `folder_paths.get_filename_list("loras")`
  (`py/server/routes_model_info.py:35`); `/model_gallery/list` does the same
  (`model_gallery.py:670`). A gallery selection is byte-for-byte what rgthree
  stores and what `get_lora_by_filename` resolves — so **no translation layer**,
  and none should be invented.
- **Metadata must not leak across the pack boundary.** Trigger words, rank/alpha
  and base architecture come from this pack's corpus and `/meta` endpoint. The
  host must be able to *show* them without knowing anything about them.
- **The supported-category list must not drift** from the widget map that
  already exists.

## Decision Outcome

Register a second entry point alongside the untouched `FieldProvider`:

```ts
registerModelPicker({
  id: "model-gallery:category",
  priority: 10,
  supports: supportsCategory,
  create: ({ category, initialValue }) => /* thin wrap of createGallery */,
  createSummary: ({ category, value }) => buildSummaryStrip(category, value),
})
```

Three deliberate details:

1. **`supportsCategory` derives its set from `WIDGET_CATEGORY.values()`**, not a
   second hand-written list. Adding a widget mapping automatically makes its
   category pickable, and the two can never disagree. It also rejects non-strings
   without throwing (the kit swallows a throwing `supports()`, but a predicate
   that never throws is better than one that relies on being caught).
2. **`create` reuses `createGallery`'s existing `onSelect` hook** as the
   value-change signal rather than adding a parallel notification path inside the
   view. `select()` already fires `onSelect` *after* updating `state.currentValue`,
   so it is exactly "the value changed". The host registers its callback *after*
   `create()` returns, so the callback is held in a mutable ref rather than bound
   into the view's options at construction.
3. **`createSummary` is the only new UI**: a compact strip (base architecture ·
   family · rank/α with effective scale · precision · copy-on-tap trigger chips)
   built from the *existing* `corpusLookup`, `fetchMeta`, `triggerList` and
   `formatScale`. It returns synchronously and repaints when the reads land, so
   the host mounts it without knowing it is async. The corpus paint is skipped if
   the `/meta` upgrade won the race — the weaker view must never overwrite the
   stronger one.

The detail-fold builders (`buildDetail`, `buildTriggerBlock`, `triggerChip`) are
**not** reused directly: they are closures inside `createGallery` and carry
card-select semantics (`stopPropagation()` to avoid selecting a card) that have
no meaning outside the grid. Hoisting them out to share four lines of chip markup
would be a larger, riskier refactor than the compact strip it would serve, so the
strip reuses the *pure* helpers and owns its own small DOM.

### Positive Consequences

- Power Lora Loader rows become pickable from the card grid, with trigger words
  and training metadata, on any host that adopts the registry.
- Zero change to the on-canvas path or to the existing `FieldProvider`.
- The picker is reusable by any future host that knows a category but has no
  widget.

### Negative Consequences

- Two registrations to keep in mind in one file. Mitigated by both delegating to
  the same `createGallery`, and by adjacent section headers stating which keys on
  a widget and which on a category.
- `createSummary` duplicates ~15 lines of chip/fact markup that the detail fold
  also has. Accepted deliberately (see above) rather than paid for with a
  closure-hoisting refactor.

## Consequences for the dependency

`@laurigates/comfy-modal-kit` moves `^0.4.0` → `^0.8.0`. The pack was already
importing APIs added after 0.4.0 (`notify`, `patchWidgetPointer`,
`copyTextToClipboard`), so the old range under-declared what it needed; this
corrects that as well as picking up `registerModelPicker`.

## Links

- comfy-modal-kit ADR-0003 — the registry and why it is separate from
  `FieldProvider`.
- [ADR-0002](0002-adopt-field-provider-and-click-coordinator.md) — the
  widget-keyed provider this sits beside.
- comfyui-prompt-editor ADR-0003 — the consumer side.
