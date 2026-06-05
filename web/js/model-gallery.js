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
import {
  compileCorpus,
  corpusFields,
  lookup as corpusLookup,
  formatTooltip,
} from "./model-corpus.js";

const EXT_NAME = "comfyui-model-gallery";
const LIST_URL = "/model_gallery/list";
const META_URL = "/model_gallery/meta";
const CORPUS_URL = `/extensions/${EXT_NAME}/data/models.json`;
const STYLE_ID = "mg-style";

// ============================================================
// Corpus (tier 1: filename-heuristic) + embedded metadata (tier 2: header read)
// ============================================================
//
// Two layers of "what is this model". The corpus is a static JSON of
// base-architecture families + notable models matched BY FILENAME — instant,
// universal (works for .ckpt/.pth/no-metadata files), offline. The /meta
// endpoint reads a single .safetensors header for AUTHORITATIVE base + LoRA
// training info; the picker fetches it lazily (on demand / for the current
// value) and prefers it over the corpus guess when present.

let CORPUS = { exact: {}, prefix: [] };
let CORPUS_LOADED = false;

async function loadCorpus() {
  if (CORPUS_LOADED) return;
  try {
    const r = await fetch(CORPUS_URL, { cache: "no-cache" });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    CORPUS = compileCorpus(await r.json());
    CORPUS_LOADED = true;
  } catch (e) {
    console.warn(`[${EXT_NAME}] corpus load failed`, e);
  }
}

// Resolve (and memoise on the listing item) the corpus entry for a file, so
// the ~50-pattern scan runs once per item, not once per render/keystroke.
function infoForItem(item, category) {
  if (item._mgInfo === undefined) {
    item._mgInfo = corpusLookup(CORPUS, item.name, category) ?? null;
  }
  return item._mgInfo;
}

// Per-(category,name) cache of the embedded-metadata fetch. Values are the
// curated meta object, or null once a fetch resolved with nothing usable.
const META_CACHE = new Map();
const metaKey = (category, name) => `${category}\u0000${name}`;

async function fetchMeta(category, name) {
  const key = metaKey(category, name);
  if (META_CACHE.has(key)) return META_CACHE.get(key);
  let result = null;
  try {
    const url = `${META_URL}?category=${encodeURIComponent(category)}&name=${encodeURIComponent(name)}`;
    const r = await fetch(url, { cache: "no-cache" });
    const data = await r.json();
    if (data?.ok && data.meta && Object.keys(data.meta).length) result = data.meta;
  } catch (e) {
    console.warn(`[${EXT_NAME}] meta fetch failed for ${name}`, e);
  }
  META_CACHE.set(key, result);
  return result;
}

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
    // The ⓘ affordance reveals embedded file metadata WITHOUT selecting —
    // intercept it before the card-commit handler below.
    const infoBtn = e.target.closest(".mg-info-btn");
    if (infoBtn) {
      e.stopPropagation();
      toggleDetail(infoBtn.closest(".mg-card"));
      return;
    }
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

    // 2. Fuzzy rank by query over the FULL relative name (primary field) plus
    //    the corpus metadata (secondary) so "sdxl"/"anime"/"upscale" find files
    //    by what they ARE, not just their cryptic name. Empty query keeps
    //    folder_paths' own order (already name-sorted).
    let rows;
    if (state.query) {
      const scored = [];
      for (const it of inChip) {
        const info = infoForItem(it, category);
        const ranked = fuzzyRank(state.query, [it.name, ...corpusFields(info).filter(Boolean)]);
        if (ranked) scored.push({ it, info, ranked });
      }
      scored.sort((a, b) => b.ranked.score - a.ranked.score);
      rows = scored;
    } else {
      rows = inChip.map((it) => ({
        it,
        info: infoForItem(it, category),
        ranked: { primaryMatches: [] },
      }));
    }

    for (const { it, info, ranked } of rows) {
      gridEl.appendChild(buildCard(it, ranked.primaryMatches, info));
    }

    if (!rows.length) {
      const el = document.createElement("div");
      el.className = "mg-empty";
      el.textContent = state.items.length ? "No matching models." : "No models in this category.";
      gridEl.appendChild(el);
    }

    setCount(rows.length, state.items.length);
  }

  function buildCard(item, matches, info) {
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

    // ⓘ affordance: read embedded file metadata without selecting the card.
    const infoBtn = document.createElement("button");
    infoBtn.type = "button";
    infoBtn.className = "mg-info-btn";
    infoBtn.textContent = "ⓘ";
    infoBtn.title = "Read embedded file metadata";

    const metaEl = document.createElement("div");
    metaEl.className = "mg-card-meta";
    metaEl.textContent = item.mtime ? new Date(item.mtime * 1000).toLocaleDateString() : "";

    card.append(infoBtn, subEl, nameEl);

    // Corpus (filename-heuristic) badges + summary — instant, additive.
    const badgesEl = buildBadges(info);
    if (badgesEl) card.append(badgesEl);
    if (info?.summary) {
      const sumEl = document.createElement("div");
      sumEl.className = "mg-card-summary";
      sumEl.textContent = info.summary;
      card.append(sumEl);
    }

    card.append(metaEl);

    // If embedded metadata was already read for this file, show it inline so
    // it survives re-renders (filter changes) without a refetch.
    const cached = META_CACHE.get(metaKey(category, item.name));
    if (cached) {
      card.classList.add("mg-expanded");
      card.append(buildDetail(cached));
    }
    return card;
  }

  // Corpus badges: base architecture (the key compatibility signal), the
  // specific family/model when distinct, and a type tag. Returns null when the
  // corpus has nothing — the card then just shows the bare name.
  function buildBadges(info) {
    if (!info) return null;
    const wrap = document.createElement("div");
    wrap.className = "mg-badges";
    const add = (text, cls) => {
      if (!text) return;
      const b = document.createElement("span");
      b.className = `mg-badge ${cls}`;
      b.textContent = text;
      wrap.appendChild(b);
    };
    add(info.base, "mg-badge-base");
    if (info.family && info.family !== info.base) add(info.family, "mg-badge-family");
    add(info.type, "mg-badge-type");
    return wrap.childElementCount ? wrap : null;
  }

  // The "From file metadata" block: the AUTHORITATIVE tier-2 read. `meta` is
  // null when the file carries nothing usable (or isn't a safetensors).
  function buildDetail(meta) {
    const d = document.createElement("div");
    d.className = "mg-detail";
    if (!meta) {
      d.classList.add("mg-detail-empty");
      d.textContent = "No embedded metadata.";
      return d;
    }
    const head = document.createElement("div");
    head.className = "mg-detail-head";
    head.textContent = "From file metadata";
    d.appendChild(head);

    const rows = [];
    if (meta.base) rows.push(["Base", meta.base]);
    if (meta.title) rows.push(["Title", meta.title]);
    if (meta.network_module) rows.push(["Network", meta.network_module]);
    if (meta.rank) rows.push(["Rank", meta.alpha ? `${meta.rank} / α ${meta.alpha}` : meta.rank]);
    else if (meta.alpha) rows.push(["Alpha", meta.alpha]);
    if (meta.resolution) rows.push(["Trained", meta.resolution]);
    for (const [k, v] of rows) {
      const r = document.createElement("div");
      r.className = "mg-detail-row";
      const kk = document.createElement("strong");
      kk.textContent = `${k}: `;
      r.append(kk, document.createTextNode(v));
      d.appendChild(r);
    }

    if (Array.isArray(meta.tags) && meta.tags.length) {
      const t = document.createElement("div");
      t.className = "mg-tags";
      for (const tag of meta.tags) {
        const s = document.createElement("span");
        s.className = "mg-tag";
        s.textContent = tag;
        t.appendChild(s);
      }
      d.appendChild(t);
    }
    if (meta.description) {
      const ds = document.createElement("div");
      ds.className = "mg-detail-desc";
      ds.textContent = meta.description;
      d.appendChild(ds);
    }
    return d;
  }

  // Reveal/hide the embedded-metadata block for a card, fetching lazily.
  function toggleDetail(card) {
    if (!card) return;
    const existing = card.querySelector(".mg-detail");
    if (existing) {
      existing.remove();
      card.classList.remove("mg-expanded");
      return;
    }
    card.classList.add("mg-expanded");
    const name = card.dataset.value;
    const placeholder = document.createElement("div");
    placeholder.className = "mg-detail mg-detail-loading";
    placeholder.textContent = "Reading metadata…";
    card.appendChild(placeholder);
    fetchMeta(category, name).then((meta) => {
      // The grid may have re-rendered (filter changed) while the fetch was in
      // flight — only patch if this placeholder is still mounted.
      if (!placeholder.isConnected) return;
      placeholder.replaceWith(buildDetail(meta));
    });
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

  // Eagerly read the embedded metadata for the CURRENT value (one request) and
  // reveal it on its card — the model the user already picked is the one they
  // most want details on. Other files stay corpus-only until the ⓘ is tapped.
  function revealCurrentValueMeta() {
    if (!state.currentValue) return;
    fetchMeta(category, state.currentValue).then((meta) => {
      if (!meta) return;
      const card = gridEl.querySelector(".mg-card.is-selected");
      if (card && !card.querySelector(".mg-detail")) {
        card.classList.add("mg-expanded");
        card.append(buildDetail(meta));
      }
    });
  }

  // ---- First paint: load the corpus + the listing together ----
  modal.setBusy(true);
  modal.setStatus("Loading…");
  Promise.all([loadCorpus(), fetchListing(category)])
    .then(([, items]) => {
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
      revealCurrentValueMeta();
    });
}

// ============================================================
// Node enhancement
// ============================================================

// The bare filename (no subfolder) of a combo value, for tooltip headers.
function tooltipName(value) {
  return (value ?? "").toString().replace(/\\/g, "/").split("/").pop();
}

// Rewrite a widget's native tooltip (desktop hover / touch long-press) with
// the corpus description of its current value, upgraded by embedded metadata
// when the file carries it. Additive: stashes and restores the original
// tooltip, and never overwrites with an empty string.
function refreshWidgetTooltip(widget) {
  const category = categoryForWidget(widget);
  if (!category) return;
  const value = (widget.value ?? "").toString();
  widget.options = widget.options || {};
  if (widget._mgOrigTooltip === undefined) widget._mgOrigTooltip = widget.options.tooltip;

  const info = corpusLookup(CORPUS, value, category);
  const tip = formatTooltip(tooltipName(value), info);
  const apply = (text) => {
    const t = text || widget._mgOrigTooltip;
    widget.options.tooltip = t;
    widget.tooltip = t;
  };
  apply(tip);

  // Upgrade asynchronously with the authoritative header read, if any.
  fetchMeta(category, value).then((meta) => {
    if (!meta) return;
    if ((widget.value ?? "").toString() !== value) return; // value moved on
    apply(formatTooltip(tooltipName(value), { ...(info || {}), ...meta }));
  });
}

// Refresh tooltips on every already-patched widget — called after the corpus
// finishes loading (nodeCreated may have run with an empty corpus).
function refreshAllTooltips() {
  for (const node of app?.graph?._nodes ?? []) {
    for (const w of node.widgets ?? []) {
      if (w._modelGalleryPatched) {
        try {
          refreshWidgetTooltip(w);
        } catch (e) {
          console.warn(`[${EXT_NAME}] tooltip refresh failed`, e);
        }
      }
    }
  }
}

function enhanceNode(node) {
  for (const w of node?.widgets ?? []) {
    if (!categoryForWidget(w)) continue; // not a model combo we handle
    if (!isComboWidget(w)) continue; // STRING widget sharing the name — defer
    if (w._modelGalleryPatched) continue; // guard against double-patching
    w._modelGalleryPatched = true;

    // Tooltip: corpus/embedded info for the current value, refreshed on change.
    try {
      refreshWidgetTooltip(w);
    } catch (e) {
      console.warn(`[${EXT_NAME}] tooltip init failed`, e);
    }
    const origCb = w.callback;
    w.callback = function (value, ...rest) {
      const r = origCb ? origCb.call(this, value, ...rest) : undefined;
      try {
        refreshWidgetTooltip(w);
      } catch (e) {
        console.warn(`[${EXT_NAME}] tooltip refresh failed`, e);
      }
      return r;
    };

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
.mg-card {
    position: relative; /* anchor the ⓘ button */
}
.mg-info-btn {
    position: absolute;
    top: 4px;
    right: 4px;
    width: 26px;
    height: 26px;
    line-height: 1;
    padding: 0;
    border: 1px solid #3a3a44;
    border-radius: 5px;
    background: #2a2a36;
    color: #9aa0ad;
    font-size: 14px;
    cursor: pointer;
    opacity: 0.55;
    font-family: inherit;
}
.mg-card:hover .mg-info-btn,
.mg-info-btn:hover {
    opacity: 1;
    color: #9ec6ff;
    border-color: #4a5878;
}
.mg-badges {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    margin-top: 2px;
}
.mg-badge {
    display: inline-block;
    padding: 1px 6px;
    border-radius: 3px;
    font-size: 10.5px;
    line-height: 1.5;
    background: #2a2a36;
    color: #b8b8c0;
    border: 1px solid #3a3a44;
    white-space: nowrap;
}
.mg-badge-base { color: #9ec6ff; border-color: #2a3a4a; }
.mg-badge-family { color: #c8a8ff; border-color: #3a2e4a; }
.mg-badge-type { color: #b8c8a8; border-color: #2e3a2a; }
.mg-card-summary {
    font-size: 11px;
    color: #9aa0ad;
    line-height: 1.35;
    margin-top: 3px;
    /* Clamp to keep cards uniform; the tooltip / ⓘ detail show the full text. */
    display: -webkit-box;
    -webkit-line-clamp: 3;
    -webkit-box-orient: vertical;
    overflow: hidden;
}
.mg-detail {
    margin-top: 6px;
    padding: 6px 8px;
    background: #1a1a22;
    border: 1px solid #2f2f3a;
    border-radius: 5px;
    font-size: 11px;
    color: #b8b8c0;
    line-height: 1.4;
}
.mg-detail-loading,
.mg-detail-empty {
    color: #777;
    font-style: italic;
}
.mg-detail-head {
    color: #7a8aa0;
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    margin-bottom: 3px;
}
.mg-detail-row strong { color: #aaa; font-weight: 600; }
.mg-detail-desc {
    margin-top: 4px;
    color: #9aa0ad;
}
.mg-tags {
    display: flex;
    flex-wrap: wrap;
    gap: 3px;
    margin-top: 5px;
}
.mg-tag {
    background: #26262f;
    border: 1px solid #34343e;
    border-radius: 10px;
    padding: 1px 7px;
    font-size: 10px;
    color: #c0c0c8;
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
    // Load the corpus once at startup, then refresh tooltips on any nodes that
    // were enhanced before it arrived.
    async setup() {
      await loadCorpus();
      try {
        refreshAllTooltips();
      } catch (e) {
        console.warn(`[${EXT_NAME}] initial tooltip pass failed`, e);
      }
    },
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
