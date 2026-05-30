// Model Gallery — ComfyUI frontend extension.
//
// Served at /extensions/comfyui-model-gallery/js/model-gallery.js — the pack
// directory name IS this URL segment. Do not rename the pack dir without
// syncing EXT_NAME below (used for log prefixes and the /model_gallery/ fetch).
//
// Pattern (shared with gallery-loader / sampler-info):
//   registerExtension -> enhance each node (on create AND on graph load) ->
//   wrap widget.onPointerDown on widgets matched BY NAME -> open an HTML
//   modal instead of the native LiteGraph combo. Additive + mobile-first:
//   chain to the original handler first, fall back to the native control on
//   dismiss/error, and write back the EXACT combo string (value contract —
//   don't churn serialized workflows). Requires the modern frontend's
//   onPointerDown hook (comfyui-frontend-package >= 1.40).

import { app } from "../../../scripts/app.js";
import { fuzzyRank, highlightMatches } from "./modal-fuzzy.js";
import { openModalShell } from "./modal-shell.js";

const EXT_NAME = "comfyui-model-gallery";
const LIST_URL = "/model_gallery/list";
const STYLE_ID = "mg-style";

// Widget name -> folder_paths category. Detection is BY NAME so the picker
// is generic across node packs: any node exposing a widget called `lora_name`
// gets the LoRA gallery, whatever its node type. The category string is what
// the /model_gallery/list endpoint enumerates via folder_paths.
//
// clip_name / clip_name1..4 / clip_name2 etc. all map to the "clip" category
// (DualCLIPLoader, TripleCLIPLoader, QuadrupleCLIPLoader number their slots).
const WIDGET_CATEGORY = new Map([
  ["lora_name", "loras"],
  ["ckpt_name", "checkpoints"],
  ["vae_name", "vae"],
  ["control_net_name", "controlnet"],
  ["unet_name", "diffusion_models"],
  ["clip_name", "clip"],
  ["clip_name1", "clip"],
  ["clip_name2", "clip"],
  ["clip_name3", "clip"],
  ["clip_name4", "clip"],
  ["style_model_name", "style_models"],
  ["gligen_name", "gligen"],
  ["upscale_model", "upscale_models"],
  ["clip_vision_name", "clip_vision"],
  ["hypernetwork_name", "hypernetworks"],
  ["photomaker_model_name", "photomaker"],
]);

// Resolve a widget to its folder_paths category, or null if this pack does
// not handle it (then we defer entirely to the native combo). Exported shape
// kept pure for unit testing.
function categoryForWidget(w) {
  if (!w || typeof w.name !== "string") return null;
  return WIDGET_CATEGORY.get(w.name) ?? null;
}

// A widget is a real combo we can take over only if it carries an
// options.values array (the native dropdown's source). STRING widgets that
// merely share a name are left to the native control.
function isComboWidget(w) {
  return !!w && Array.isArray(w.options?.values);
}

// ============================================================
// Listing fetch
// ============================================================

async function fetchListing(category) {
  const url = `${LIST_URL}?category=${encodeURIComponent(category)}`;
  const r = await fetch(url, { cache: "no-cache" });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const data = await r.json();
  if (!data?.ok) throw new Error(data?.error || "listing failed");
  return Array.isArray(data.items) ? data.items : [];
}

// ============================================================
// Subfolder chips
// ============================================================

// Top-level subfolder of a folder_paths relative name. "flux/realism.sft"
// -> "flux"; a top-level file -> "" (rendered as the "All" / root chip).
function topLevelSubfolder(item) {
  const sub = (item.subfolder || "").replace(/\\/g, "/");
  if (!sub) return "";
  const idx = sub.indexOf("/");
  return idx < 0 ? sub : sub.slice(0, idx);
}

// The displayed basename line for a card: the exact combo name with its
// subfolder prefix stripped. Pure so the value-contract slice (never mutate
// item.name; only derive a display string) is unit-testable. Backslashes are
// normalised to match topLevelSubfolder/subfolder so the prefix length lines
// up. A subfolder that isn't actually a prefix of name (defensive — should
// not happen) leaves the full name intact.
function basenameOf(name, subfolder) {
  const n = (name ?? "").toString().replace(/\\/g, "/");
  const sub = (subfolder || "").replace(/\\/g, "/");
  if (sub && n.startsWith(`${sub}/`)) return n.slice(sub.length + 1);
  return n;
}

// Remap fuzzy-match indices computed against the FULL relative name onto the
// basename line. Subtract the subfolder-prefix length and drop any index that
// landed in the subfolder portion or fell out of the basename range. Pure +
// exported so the (fiddly, off-by-one-prone) offset math has direct coverage.
function remapMatches(matches, subfolder, baseLength) {
  if (!matches?.length) return [];
  const sub = (subfolder || "").replace(/\\/g, "/");
  const offset = sub ? sub.length + 1 : 0;
  return matches.map((i) => i - offset).filter((i) => i >= 0 && i < baseLength);
}

// Distinct top-level subfolders present in the listing, sorted, for the
// optional filter chips. Returns [] when everything is top-level (no chips).
function subfolderChips(items) {
  const set = new Set();
  let hasRoot = false;
  for (const it of items) {
    const top = topLevelSubfolder(it);
    if (top) set.add(top);
    else hasRoot = true;
  }
  if (!set.size) return [];
  const chips = [...set].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
  // Lead with "All", then a root chip only if loose top-level files exist.
  return hasRoot ? ["__all__", "__root__", ...chips] : ["__all__", ...chips];
}

// ============================================================
// Picker modal
// ============================================================

function openPicker(widget, node) {
  ensureStyle();

  const category = categoryForWidget(widget);
  if (!category) return; // defensive — enhanceNode only patches matched widgets

  const state = {
    items: [],
    query: "",
    chip: "__all__", // active subfolder chip
    chips: [],
    currentValue: (widget.value ?? "").toString(),
  };

  const modal = openModalShell({
    title: "Choose model",
    subtitle: `(${widget.name})`,
    placeholder: "Filter by name…",
    width: "min(1100px, calc(100vw - 16px))",
    height: "min(88vh, 820px)",
    footerLeftHTML: "<kbd>Esc</kbd> close · tap a card to select",
    footerRightHTML: '<span class="mg-count"></span>',
  });

  // Toolbar: subfolder filter chips.
  const chipsEl = document.createElement("div");
  chipsEl.className = "mg-chips";
  modal.toolbarEl.appendChild(chipsEl);

  // Body: card grid.
  const gridEl = document.createElement("div");
  gridEl.className = "mg-grid";
  modal.bodyEl.appendChild(gridEl);

  const countEl = modal.footerEl.querySelector(".mg-count");
  function setCount(visible, total) {
    if (countEl) countEl.textContent = `${visible} / ${total}`;
  }

  // ---- Wiring ----
  modal.searchEl.addEventListener("input", () => {
    state.query = modal.searchEl.value.trim();
    renderGrid();
  });

  chipsEl.addEventListener("click", (e) => {
    const b = e.target.closest("[data-chip]");
    if (!b) return;
    state.chip = b.dataset.chip;
    renderChips();
    renderGrid();
  });

  gridEl.addEventListener("click", (e) => {
    const card = e.target.closest(".mg-card");
    if (!card) return;
    commit(card.dataset.value);
  });

  // ---- Render ----
  function chipLabel(chip) {
    if (chip === "__all__") return "All";
    if (chip === "__root__") return "(root)";
    return chip;
  }

  function renderChips() {
    chipsEl.innerHTML = "";
    if (!state.chips.length) {
      chipsEl.style.display = "none";
      return;
    }
    chipsEl.style.display = "";
    for (const chip of state.chips) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "mg-chip";
      b.dataset.chip = chip;
      b.textContent = chipLabel(chip);
      if (chip === state.chip) b.classList.add("is-active");
      chipsEl.appendChild(b);
    }
  }

  function matchesChip(item) {
    if (state.chip === "__all__") return true;
    const top = topLevelSubfolder(item);
    if (state.chip === "__root__") return top === "";
    return top === state.chip;
  }

  function renderGrid() {
    gridEl.innerHTML = "";

    // 1. Filter by active subfolder chip.
    const inChip = state.items.filter(matchesChip);

    // 2. Fuzzy rank by query over the FULL relative name (primary field).
    //    Empty query keeps folder_paths' own order (already name-sorted).
    let rows;
    if (state.query) {
      const scored = [];
      for (const it of inChip) {
        const ranked = fuzzyRank(state.query, [it.name]);
        if (ranked) scored.push({ it, ranked });
      }
      scored.sort((a, b) => b.ranked.score - a.ranked.score);
      rows = scored;
    } else {
      rows = inChip.map((it) => ({ it, ranked: { primaryMatches: [] } }));
    }

    for (const { it, ranked } of rows) {
      gridEl.appendChild(buildCard(it, ranked.primaryMatches));
    }

    if (!rows.length) {
      const el = document.createElement("div");
      el.className = "mg-empty";
      el.textContent = state.items.length ? "No matching models." : "No models in this category.";
      gridEl.appendChild(el);
    }

    setCount(rows.length, state.items.length);
  }

  function buildCard(item, matches) {
    const card = document.createElement("div");
    card.className = "mg-card";
    // The EXACT folder_paths name is the combo value — store it verbatim.
    card.dataset.value = item.name;
    if (item.name === state.currentValue) card.classList.add("is-selected");

    const sub = (item.subfolder || "").replace(/\\/g, "/");
    const base = basenameOf(item.name, item.subfolder);

    const subEl = document.createElement("div");
    subEl.className = "mg-card-sub";
    subEl.textContent = sub ? `${sub}/` : " "; // nbsp keeps row height stable

    const nameEl = document.createElement("div");
    nameEl.className = "mg-card-name";
    nameEl.title = item.name;
    // Highlight matches against the FULL name, but display only the basename
    // line under the subfolder line. Re-map full-name match indices onto the
    // basename by subtracting the subfolder-prefix length; drop matches that
    // landed in the subfolder portion (the chip/sub line already shows it).
    if (matches?.length) {
      const local = remapMatches(matches, item.subfolder, base.length);
      nameEl.appendChild(highlightMatches(base, local));
    } else {
      nameEl.textContent = base;
    }

    const metaEl = document.createElement("div");
    metaEl.className = "mg-card-meta";
    metaEl.textContent = item.mtime ? new Date(item.mtime * 1000).toLocaleDateString() : "";

    card.append(subEl, nameEl, metaEl);
    return card;
  }

  // Commit the EXACT combo value the native dropdown uses. Do not re-encode
  // or normalise — matching the native value is the value contract.
  function commit(value) {
    try {
      // Guard: only commit values the native combo recognises. The listing
      // is the same folder_paths source, so this should always hold, but a
      // stale listing (file added after node creation) could miss — fall
      // back gracefully by leaving the value as-is and warning.
      const values = widget.options?.values;
      if (Array.isArray(values) && !values.includes(value)) {
        // Append so LiteGraph's own validation treats it as a known option.
        values.push(value);
      }
      widget.value = value;
      try {
        widget.callback?.call(widget, value, app.canvas, node);
      } catch (e) {
        console.warn(`[${EXT_NAME}] widget callback threw`, e);
      }
      node?.setDirtyCanvas?.(true, true);
      app.graph?.setDirtyCanvas?.(true, true);
    } catch (e) {
      console.warn(`[${EXT_NAME}] commit failed`, e);
    }
    modal.close();
  }

  // ---- First paint: load the listing ----
  modal.setBusy(true);
  modal.setStatus("Loading…");
  fetchListing(category)
    .then((items) => {
      state.items = items;
      state.chips = subfolderChips(items);
      modal.setStatus("");
    })
    .catch((e) => {
      console.warn(`[${EXT_NAME}] list failed for ${category}`, e);
      state.items = [];
      state.chips = [];
      modal.setStatus(`Error: ${e.message}`);
    })
    .finally(() => {
      modal.setBusy(false);
      renderChips();
      renderGrid();
    });
}

// ============================================================
// Node enhancement
// ============================================================

function enhanceNode(node) {
  for (const w of node?.widgets ?? []) {
    if (!categoryForWidget(w)) continue; // not a model combo we handle
    if (!isComboWidget(w)) continue; // STRING widget sharing the name — defer
    if (w._modelGalleryPatched) continue; // guard against double-patching
    w._modelGalleryPatched = true;

    // Strategy A: wrap onPointerDown. Chain to the original first; only open
    // our modal if the original didn't consume the event. Fall back to the
    // native control on error.
    const origDown = w.onPointerDown;
    w.onPointerDown = function (pointer, ownerNode, canvas) {
      try {
        if (typeof origDown === "function") {
          const consumed = origDown.call(this, pointer, ownerNode, canvas);
          if (consumed) return consumed;
        }
        openPicker(w, ownerNode || node);
        return true; // consume — suppresses the native dropdown
      } catch (e) {
        console.warn(`[${EXT_NAME}] picker open failed`, e);
        return false; // fall back to native on error
      }
    };
  }
}

// ============================================================
// Picker styles (the modal shell handles the chrome / CSS reset)
// ============================================================

const PICKER_CSS = `
.mg-chips {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    align-items: center;
}
.mg-chip {
    background: #2a2a36;
    color: #b8b8c0;
    border: 1px solid #3a3a44;
    border-radius: 14px;
    /* >=44px tap target via padding + line-height for touch. */
    min-height: 32px;
    padding: 6px 14px;
    font-size: 13px;
    cursor: pointer;
    font-family: inherit;
}
.mg-chip:hover {
    background: #3a3a4a;
    color: #fff;
}
.mg-chip.is-active {
    background: #2f3a52;
    color: #9ec6ff;
    border-color: #4a5878;
}
.mg-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
    gap: 10px;
    padding: 4px;
}
.mg-card {
    background: #21212a;
    border: 1px solid #2a2a32;
    border-radius: 6px;
    /* Big tap target — comfortably over 44px tall. */
    min-height: 56px;
    padding: 8px 10px;
    cursor: pointer;
    display: flex;
    flex-direction: column;
    gap: 2px;
    transition: transform 0.06s ease, border-color 0.1s ease;
}
.mg-card:hover {
    border-color: #6ba6ff;
    transform: translateY(-1px);
}
.mg-card.is-selected {
    border-color: #6bff8e;
    box-shadow: 0 0 0 1px #6bff8e inset;
}
.mg-card-sub {
    font-size: 11px;
    color: #7a8aa0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
}
.mg-card-name {
    font-size: 13.5px;
    color: #e8e8ea;
    word-break: break-all;
    font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
}
.mg-card-meta {
    font-size: 10.5px;
    color: #888;
    margin-top: auto;
}
.mg-empty {
    grid-column: 1 / -1;
    padding: 40px;
    text-align: center;
    color: #777;
    font-style: italic;
}
.mg-count {
    color: #888;
}
.cmp-match {
    color: #ffd866;
    font-weight: 700;
}
`;

function ensureStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const s = document.createElement("style");
  s.id = STYLE_ID;
  s.textContent = PICKER_CSS;
  document.head.appendChild(s);
}

// ============================================================
// Extension registration
// ============================================================

try {
  app.registerExtension({
    name: "comfy.model-gallery",
    // Handle freshly created nodes AND nodes restored from a saved graph.
    async nodeCreated(node) {
      try {
        enhanceNode(node);
      } catch (e) {
        console.warn(`[${EXT_NAME}] nodeCreated enhance failed`, e);
      }
    },
    async loadedGraphNode(node) {
      try {
        enhanceNode(node);
      } catch (e) {
        console.warn(`[${EXT_NAME}] loadedGraphNode enhance failed`, e);
      }
    },
  });
} catch (e) {
  console.warn(`[${EXT_NAME}] registerExtension failed`, e);
}

// Exported for the Vitest unit harness (pure helpers only — no DOM).
export {
  basenameOf,
  categoryForWidget,
  isComboWidget,
  remapMatches,
  subfolderChips,
  topLevelSubfolder,
  WIDGET_CATEGORY,
};
