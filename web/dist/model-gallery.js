// node_modules/@laurigates/comfy-modal-kit/dist/index.js
var KEY = Symbol.for("laurigates.comfyModalKit");
function getKit() {
  const g = globalThis;
  let kit = g[KEY];
  if (!kit) {
    kit = { fieldProviders: [], activeModal: null, pointerClaim: null };
    g[KEY] = kit;
  }
  return kit;
}
function registerFieldProvider(provider) {
  const list = getKit().fieldProviders;
  const i = list.findIndex((p) => p.id === provider.id);
  if (i >= 0) {
    list.splice(i, 1, provider);
  } else {
    list.push(provider);
  }
}
var guardInstalled = false;
function setActiveModal(handle) {
  installPointerGuard();
  dismissActiveModal();
  getKit().activeModal = handle;
}
function dismissActiveModal() {
  const kit = getKit();
  const active = kit.activeModal;
  if (!active)
    return;
  kit.activeModal = null;
  try {
    active.close();
  } catch (e) {
    console.warn("[comfy-modal-kit] active modal close() threw", e);
  }
}
function getActiveModal() {
  return getKit().activeModal;
}
function patchWidgetPointer(widget, opener) {
  const original = widget.onPointerDown;
  function patched(pointer, node, canvas) {
    try {
      if (typeof original === "function") {
        const consumed = original.call(this, pointer, node, canvas);
        if (consumed)
          return consumed;
      }
      return opener(pointer, node, canvas);
    } catch (e) {
      console.warn("[comfy-modal-kit] patched onPointerDown threw", e);
      return false;
    }
  }
  widget.onPointerDown = patched;
  return {
    restore() {
      widget.onPointerDown = original;
    }
  };
}
function installPointerGuard() {
  if (guardInstalled)
    return;
  if (typeof window === "undefined")
    return;
  guardInstalled = true;
  window.addEventListener("pointerdown", pointerGuard, true);
}
function pointerGuard(e) {
  const active = getKit().activeModal;
  if (!active)
    return;
  const target = e.target;
  if (active.element && target && active.element.contains(target)) {
    return;
  }
  e.stopImmediatePropagation();
  dismissActiveModal();
}
function fuzzyScore(query, target) {
  if (!query)
    return { score: 0, matches: [] };
  if (!target)
    return null;
  const q = query.toLowerCase();
  const t = target.toLowerCase();
  const matches = [];
  let qi = 0;
  let score = 0;
  let consecutive = 0;
  let prevMatchIdx = -1;
  for (let ti = 0;ti < t.length && qi < q.length; ti++) {
    if (t[ti] !== q[qi]) {
      consecutive = 0;
      continue;
    }
    let charScore = 1;
    if (ti === 0) {
      charScore += 5;
    } else {
      const prev = t[ti - 1];
      const orig = target[ti];
      if (prev === "_" || prev === "-" || prev === " " || prev === "." || prev === "/") {
        charScore += 4;
      } else if (prev !== undefined && prev >= "a" && prev <= "z" && orig !== undefined && orig >= "A" && orig <= "Z") {
        charScore += 3;
      }
    }
    if (ti === prevMatchIdx + 1) {
      consecutive++;
      charScore += consecutive * 2;
    } else {
      consecutive = 0;
    }
    score += charScore;
    matches.push(ti);
    prevMatchIdx = ti;
    qi++;
  }
  if (qi < q.length)
    return null;
  score -= target.length * 0.01;
  return { score, matches };
}
function fuzzyRank(query, fields, primaryWeight = 10) {
  if (!query)
    return { score: 0, primaryMatches: [] };
  const tokens = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  if (!tokens.length)
    return { score: 0, primaryMatches: [] };
  const primary = fields[0] || "";
  const rest = fields.slice(1).filter((f) => Boolean(f));
  let totalScore = 0;
  const primaryMatchSet = new Set;
  for (const token of tokens) {
    const primaryResult = fuzzyScore(token, primary);
    let best = primaryResult ? {
      score: primaryResult.score * primaryWeight,
      matches: primaryResult.matches,
      onPrimary: true
    } : null;
    for (const field of rest) {
      const r = fuzzyScore(token, field);
      if (r && (!best || r.score > best.score)) {
        best = { score: r.score, matches: r.matches, onPrimary: false };
      }
    }
    if (!best)
      return null;
    totalScore += best.score;
    if (best.onPrimary) {
      for (const i of best.matches)
        primaryMatchSet.add(i);
    }
  }
  return {
    score: totalScore,
    primaryMatches: [...primaryMatchSet].sort((a, b) => a - b)
  };
}
function highlightMatches(target, matchIndices) {
  const frag = document.createDocumentFragment();
  if (!target)
    return frag;
  const set = new Set(matchIndices || []);
  if (!set.size) {
    frag.appendChild(document.createTextNode(target));
    return frag;
  }
  for (let i = 0;i < target.length; i++) {
    const ch = target[i];
    if (set.has(i)) {
      const m = document.createElement("span");
      m.className = "cmp-match";
      m.textContent = ch;
      frag.appendChild(m);
    } else {
      frag.appendChild(document.createTextNode(ch));
    }
  }
  return frag;
}
var STYLE_ID = "cmn-notify-style";
var CONTAINER_ID = "cmn-notify-container";
function defaultLife(severity) {
  switch (severity) {
    case "error":
      return 0;
    case "warn":
      return 8000;
    default:
      return 4000;
  }
}
function defaultCopyable(severity) {
  return severity === "error" || severity === "warn";
}
function notifyClipboardText(summary, detail) {
  return detail ? `${summary}
${detail}` : summary;
}
async function copyTextToClipboard(text) {
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {}
  try {
    if (typeof document === "undefined")
      return false;
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.top = "-1000px";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}
var CSS2 = `
.cmn-container {
    position: fixed;
    top: 12px;
    right: 12px;
    z-index: 10000;
    display: flex;
    flex-direction: column;
    gap: 8px;
    width: min(380px, calc(100vw - 24px));
    pointer-events: none;
    font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
}
.cmn-toast {
    pointer-events: auto;
    background: #1a1a1f;
    color: #e8e8ea;
    border: 1px solid #3a3a44;
    border-left-width: 4px;
    border-radius: 8px;
    box-shadow: 0 8px 28px rgba(0, 0, 0, 0.6);
    padding: 10px 12px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    font-size: 13px;
    line-height: 1.4;
    animation: cmn-in 0.16s ease-out;
}
@keyframes cmn-in {
    from { transform: translateY(-8px); opacity: 0; }
    to   { transform: translateY(0);    opacity: 1; }
}
.cmn-toast.cmn-success { border-left-color: #4caf50; }
.cmn-toast.cmn-info    { border-left-color: #6ba6ff; }
.cmn-toast.cmn-warn    { border-left-color: #e0a83a; }
.cmn-toast.cmn-error   { border-left-color: #e0533a; }
.cmn-row {
    display: flex;
    align-items: flex-start;
    gap: 10px;
}
.cmn-text {
    flex: 1;
    min-width: 0;
    word-break: break-word;
}
.cmn-summary { font-weight: 600; }
.cmn-detail  { color: #b8b8c0; margin-top: 2px; white-space: pre-wrap; }
.cmn-close {
    background: transparent;
    color: #aaa;
    border: none;
    cursor: pointer;
    font-size: 18px;
    line-height: 1;
    padding: 0;
    width: 24px;
    height: 24px;
    flex-shrink: 0;
}
.cmn-close:hover { color: #fff; }
.cmn-actions { display: flex; gap: 8px; }
.cmn-copy {
    background: #2a2a36;
    color: #d8d8e0;
    border: 1px solid #3a3a44;
    border-radius: 5px;
    /* Touch-first: comfortable tap target, 13px text. */
    min-height: 32px;
    padding: 6px 12px;
    cursor: pointer;
    font-size: 13px;
    font-family: inherit;
    display: inline-flex;
    align-items: center;
    gap: 6px;
}
.cmn-copy:hover  { background: #34343f; color: #fff; }
.cmn-copy.cmn-copied { background: #2f4a30; border-color: #4caf50; color: #cfe8d0; }
`;
function ensureStyle() {
  if (typeof document === "undefined")
    return;
  if (document.getElementById(STYLE_ID))
    return;
  const s = document.createElement("style");
  s.id = STYLE_ID;
  s.textContent = CSS2;
  document.head.appendChild(s);
}
function ensureContainer() {
  let c = document.getElementById(CONTAINER_ID);
  if (!c) {
    c = document.createElement("div");
    c.id = CONTAINER_ID;
    c.className = "cmn-container";
    document.body.appendChild(c);
  }
  return c;
}
function notify(opts) {
  const { severity, summary, detail } = opts;
  if (typeof document === "undefined" || !document.body) {
    console.info(`[notify] ${severity}: ${summary}${detail ? ` — ${detail}` : ""}`);
    return null;
  }
  ensureStyle();
  const container = ensureContainer();
  const life = opts.life ?? defaultLife(severity);
  const copyable = opts.copyable ?? defaultCopyable(severity);
  const toast = document.createElement("div");
  toast.className = `cmn-toast cmn-${severity}`;
  toast.setAttribute("role", severity === "error" ? "alert" : "status");
  let timer;
  const close = () => {
    if (timer)
      clearTimeout(timer);
    toast.remove();
    if (container.childElementCount === 0)
      container.remove();
  };
  const row = document.createElement("div");
  row.className = "cmn-row";
  const text = document.createElement("div");
  text.className = "cmn-text";
  const summaryEl = document.createElement("div");
  summaryEl.className = "cmn-summary";
  summaryEl.textContent = summary;
  text.appendChild(summaryEl);
  if (detail) {
    const detailEl = document.createElement("div");
    detailEl.className = "cmn-detail";
    detailEl.textContent = detail;
    text.appendChild(detailEl);
  }
  const closeBtn = document.createElement("button");
  closeBtn.className = "cmn-close";
  closeBtn.type = "button";
  closeBtn.textContent = "×";
  closeBtn.title = "Dismiss";
  closeBtn.addEventListener("click", close);
  row.append(text, closeBtn);
  toast.appendChild(row);
  if (copyable) {
    const actions = document.createElement("div");
    actions.className = "cmn-actions";
    const copyBtn = document.createElement("button");
    copyBtn.className = "cmn-copy";
    copyBtn.type = "button";
    copyBtn.textContent = "Copy";
    copyBtn.addEventListener("click", async () => {
      const ok = await copyTextToClipboard(notifyClipboardText(summary, detail));
      copyBtn.textContent = ok ? "Copied ✓" : "Copy failed";
      copyBtn.classList.toggle("cmn-copied", ok);
      setTimeout(() => {
        copyBtn.textContent = "Copy";
        copyBtn.classList.remove("cmn-copied");
      }, 1500);
    });
    actions.appendChild(copyBtn);
    toast.appendChild(actions);
  }
  container.appendChild(toast);
  if (life > 0) {
    timer = setTimeout(close, life);
  }
  return { close, el: toast };
}
var STYLE_ID2 = "cmp-shell-style";
var CSS22 = `
.cmp-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.55);
    z-index: 9998;
    backdrop-filter: blur(2px);
    touch-action: manipulation;
}
.cmp-dialog {
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    z-index: 9999;
    width: min(960px, calc(100vw - 24px));
    max-height: min(85vh, 800px);
    touch-action: manipulation;
    display: flex;
    flex-direction: column;
    background: #1a1a1f;
    color: #e8e8ea;
    border: 1px solid #3a3a44;
    border-radius: 10px;
    box-shadow: 0 16px 48px rgba(0, 0, 0, 0.7);
    font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
    font-size: 13px;
    overflow: hidden;
}
.cmp-header {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px 14px;
    border-bottom: 1px solid #2a2a32;
    background: #21212a;
    flex-shrink: 0;
}
.cmp-title {
    flex: 1;
    font-weight: 600;
    color: #9ec6ff;
    font-size: 14px;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.cmp-subtitle {
    color: #888;
    font-weight: 400;
    font-size: 12px;
    margin-left: 6px;
}
.cmp-close {
    background: transparent;
    color: #aaa;
    border: 1px solid #3a3a44;
    border-radius: 4px;
    width: 36px;
    height: 36px;
    cursor: pointer;
    font-size: 20px;
    line-height: 1;
    flex-shrink: 0;
}
.cmp-close:hover {
    background: #2a2a32;
    color: #fff;
}
.cmp-toolbar {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: center;
    padding: 8px 14px;
    border-bottom: 1px solid #2a2a32;
    background: #1f1f26;
    flex-shrink: 0;
}
.cmp-toolbar:empty {
    display: none;
}
.cmp-searchrow {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 14px;
    border-bottom: 1px solid #2a2a32;
    flex-shrink: 0;
}
.cmp-search {
    flex: 1;
    background: #12121a;
    border: 1px solid #3a3a44;
    border-radius: 4px;
    color: #e8e8ea;
    padding: 8px 12px;
    /* 16px prevents iOS auto-zoom on focus. */
    font-size: 16px;
    font-family: inherit;
    outline: none;
    min-width: 0;
}
.cmp-search:focus {
    border-color: #6ba6ff;
}
.cmp-status {
    color: #888;
    font-size: 12px;
    white-space: nowrap;
}
.cmp-body {
    flex: 1;
    overflow-y: auto;
    -webkit-overflow-scrolling: touch;
    overscroll-behavior: contain;
    padding: 8px;
    position: relative;
}
.cmp-body.is-busy {
    opacity: 0.5;
    pointer-events: none;
}
.cmp-footer {
    padding: 8px 14px;
    border-top: 1px solid #2a2a32;
    color: #777;
    font-size: 11px;
    background: #1f1f26;
    flex-shrink: 0;
    display: flex;
    justify-content: space-between;
    gap: 12px;
}
.cmp-footer:empty {
    display: none;
}
.cmp-footer kbd {
    background: #2a2a36;
    border: 1px solid #3a3a44;
    border-bottom-width: 2px;
    border-radius: 3px;
    padding: 1px 5px;
    font-family: ui-monospace, monospace;
    font-size: 10px;
    color: #b8b8c0;
}
`;
function ensureStyle2() {
  if (document.getElementById(STYLE_ID2))
    return;
  const s = document.createElement("style");
  s.id = STYLE_ID2;
  s.textContent = CSS22;
  document.head.appendChild(s);
}
function openModalShell(opts = {}) {
  ensureStyle2();
  const backdrop = document.createElement("div");
  backdrop.className = "cmp-backdrop";
  const dialog = document.createElement("div");
  dialog.className = "cmp-dialog";
  if (opts.width)
    dialog.style.width = opts.width;
  if (opts.height)
    dialog.style.maxHeight = opts.height;
  const stop = (e) => e.stopPropagation();
  for (const ev of ["pointerdown", "pointerup", "click", "dblclick", "wheel"]) {
    dialog.addEventListener(ev, stop);
  }
  const headerEl = document.createElement("div");
  headerEl.className = "cmp-header";
  const titleEl = document.createElement("div");
  titleEl.className = "cmp-title";
  titleEl.textContent = opts.title || "";
  if (opts.subtitle) {
    const sub = document.createElement("span");
    sub.className = "cmp-subtitle";
    sub.textContent = opts.subtitle;
    titleEl.appendChild(sub);
  }
  const closeBtn = document.createElement("button");
  closeBtn.className = "cmp-close";
  closeBtn.type = "button";
  closeBtn.textContent = "×";
  closeBtn.title = "Close (Esc)";
  headerEl.append(titleEl, closeBtn);
  const toolbarEl = document.createElement("div");
  toolbarEl.className = "cmp-toolbar";
  const searchRow = document.createElement("div");
  searchRow.className = "cmp-searchrow";
  const searchEl = document.createElement("input");
  searchEl.type = "search";
  searchEl.className = "cmp-search";
  searchEl.placeholder = opts.placeholder || "Filter…";
  searchEl.spellcheck = false;
  searchEl.autocomplete = "off";
  const statusEl = document.createElement("div");
  statusEl.className = "cmp-status";
  searchRow.append(searchEl, statusEl);
  if (opts.showSearch === false)
    searchRow.style.display = "none";
  const bodyEl = document.createElement("div");
  bodyEl.className = "cmp-body";
  const footerEl = document.createElement("div");
  footerEl.className = "cmp-footer";
  if (opts.showFooter !== false) {
    const l = document.createElement("div");
    if (opts.footerLeftHTML)
      l.innerHTML = opts.footerLeftHTML;
    const r = document.createElement("div");
    if (opts.footerRightHTML)
      r.innerHTML = opts.footerRightHTML;
    footerEl.append(l, r);
  } else {
    footerEl.style.display = "none";
  }
  dialog.append(headerEl, toolbarEl, searchRow, bodyEl, footerEl);
  let torn = false;
  const teardown = () => {
    if (torn)
      return;
    torn = true;
    try {
      backdrop.remove();
      dialog.remove();
      document.removeEventListener("keydown", onKey, true);
    } finally {
      try {
        opts.onClose?.();
      } catch (e) {
        console.warn("[modal-shell] onClose threw", e);
      }
    }
  };
  const handle = { id: "modal-shell", element: dialog, close: teardown };
  const requestClose = () => {
    if (getActiveModal() === handle) {
      dismissActiveModal();
    } else {
      teardown();
    }
  };
  backdrop.addEventListener("pointerdown", requestClose);
  closeBtn.addEventListener("click", requestClose);
  const onKey = (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      requestClose();
      return;
    }
    try {
      opts.onKeyDown?.(e);
    } catch (err) {
      console.warn("[modal-shell] onKeyDown threw", err);
    }
  };
  document.addEventListener("keydown", onKey, true);
  document.body.append(backdrop, dialog);
  const controller = {
    backdrop,
    dialog,
    headerEl,
    toolbarEl,
    searchEl,
    statusEl,
    bodyEl,
    footerEl,
    setBusy(b) {
      bodyEl.classList.toggle("is-busy", !!b);
    },
    setStatus(s) {
      statusEl.textContent = s || "";
    },
    close: requestClose,
    _onKey: onKey,
    opts
  };
  setActiveModal(handle);
  if (opts.showSearch !== false) {
    requestAnimationFrame(() => {
      if (getActiveModal() === handle)
        searchEl.focus();
    });
  }
  return controller;
}

// src/model-gallery.ts
import { app } from "/scripts/app.js";

// src/model-corpus.ts
var EXT_NAME = "comfyui-model-gallery";
function compileCorpus(raw) {
  const prefix = (raw?.prefix ?? []).map((p) => ({ ...p, re: safeRegex(p.match) })).filter((p) => p.re !== null);
  return { exact: raw?.exact ?? {}, prefix };
}
function safeRegex(pattern) {
  try {
    return new RegExp(pattern, "i");
  } catch (e) {
    console.warn(`[${EXT_NAME}] bad regex in corpus: ${pattern}`, e);
    return null;
  }
}
function corpusKey(name) {
  if (!name || typeof name !== "string")
    return "";
  const norm = name.replace(/\\/g, "/");
  const idx = norm.lastIndexOf("/");
  return (idx < 0 ? norm : norm.slice(idx + 1)).toLowerCase();
}
function lookup(corpus, name, category) {
  if (!corpus)
    return null;
  const key = corpusKey(name);
  if (!key)
    return null;
  const exact = corpus.exact[key];
  if (exact)
    return exact;
  for (const p of corpus.prefix) {
    if (p.categories && category && !p.categories.includes(category))
      continue;
    if (p.re.test(key))
      return p;
  }
  return null;
}
function corpusFields(info) {
  if (!info)
    return [];
  return [info.base, info.family, info.type, info.summary, info.good_for];
}
function formatTooltip(name, info) {
  if (!info)
    return "";
  const headerBits = [name];
  if (info.base)
    headerBits.push(info.base);
  if (info.family && info.family !== info.base)
    headerBits.push(info.family);
  const lines = [headerBits.join(" · "), ""];
  if (info.summary)
    lines.push(info.summary);
  if (info.good_for)
    lines.push("", `Good for: ${info.good_for}`);
  if (info.notes)
    lines.push("", `Note: ${info.notes}`);
  return lines.join(`
`).trim();
}

// src/model-gallery.ts
var EXT_NAME2 = "comfyui-model-gallery";
var LIST_URL = "/model_gallery/list";
var META_URL = "/model_gallery/meta";
var CORPUS_URL = `/extensions/${EXT_NAME2}/data/models.json`;
var STYLE_ID3 = "mg-style";
var CORPUS = { exact: {}, prefix: [] };
var CORPUS_LOADED = false;
async function loadCorpus() {
  if (CORPUS_LOADED)
    return;
  try {
    const r = await fetch(CORPUS_URL, { cache: "no-cache" });
    if (!r.ok)
      throw new Error(`HTTP ${r.status}`);
    CORPUS = compileCorpus(await r.json());
    CORPUS_LOADED = true;
  } catch (e) {
    console.warn(`[${EXT_NAME2}] corpus load failed`, e);
  }
}
function infoForItem(item, category) {
  if (item._mgInfo === undefined) {
    item._mgInfo = lookup(CORPUS, item.name, category) ?? null;
  }
  return item._mgInfo;
}
var META_CACHE = new Map;
var metaKey = (category, name) => `${category}\x00${name}`;
async function fetchMeta(category, name) {
  const key = metaKey(category, name);
  const cached = META_CACHE.get(key);
  if (cached !== undefined)
    return cached;
  let result = null;
  try {
    const url = `${META_URL}?category=${encodeURIComponent(category)}&name=${encodeURIComponent(name)}`;
    const r = await fetch(url, { cache: "no-cache" });
    const data = await r.json();
    if (data?.ok && data.meta && Object.keys(data.meta).length)
      result = data.meta;
  } catch (e) {
    console.warn(`[${EXT_NAME2}] meta fetch failed for ${name}`, e);
  }
  META_CACHE.set(key, result);
  return result;
}
var WIDGET_CATEGORY = new Map([
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
  ["photomaker_model_name", "photomaker"]
]);
function categoryForWidget(w) {
  if (!w || typeof w.name !== "string")
    return null;
  return WIDGET_CATEGORY.get(w.name) ?? null;
}
function isComboWidget(w) {
  return !!w && Array.isArray(w.options?.values);
}
async function fetchListing(category) {
  const url = `${LIST_URL}?category=${encodeURIComponent(category)}`;
  const r = await fetch(url, { cache: "no-cache" });
  if (!r.ok)
    throw new Error(`HTTP ${r.status}`);
  const data = await r.json();
  if (!data?.ok)
    throw new Error(data?.error || "listing failed");
  return Array.isArray(data.items) ? data.items : [];
}
function topLevelSubfolder(item) {
  const sub = (item.subfolder || "").replace(/\\/g, "/");
  if (!sub)
    return "";
  const idx = sub.indexOf("/");
  return idx < 0 ? sub : sub.slice(0, idx);
}
function basenameOf(name, subfolder) {
  const n = (name ?? "").toString().replace(/\\/g, "/");
  const sub = (subfolder || "").replace(/\\/g, "/");
  if (sub && n.startsWith(`${sub}/`))
    return n.slice(sub.length + 1);
  return n;
}
function remapMatches(matches, subfolder, baseLength) {
  if (!matches?.length)
    return [];
  const sub = (subfolder || "").replace(/\\/g, "/");
  const offset = sub ? sub.length + 1 : 0;
  return matches.map((i) => i - offset).filter((i) => i >= 0 && i < baseLength);
}
function subfolderChips(items) {
  const set = new Set;
  let hasRoot = false;
  for (const it of items) {
    const top = topLevelSubfolder(it);
    if (top)
      set.add(top);
    else
      hasRoot = true;
  }
  if (!set.size)
    return [];
  const chips = [...set].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
  return hasRoot ? ["__all__", "__root__", ...chips] : ["__all__", ...chips];
}
function createGallery(opts) {
  ensureStyle3();
  const { category, initialValue } = opts;
  const state = {
    items: [],
    query: "",
    chip: "__all__",
    chips: [],
    currentValue: initialValue
  };
  const el = document.createElement("div");
  el.className = "mg-inline";
  const ownSearch = !opts.searchEl;
  const searchEl = opts.searchEl ?? document.createElement("input");
  if (ownSearch) {
    searchEl.type = "text";
    searchEl.className = "mg-search";
    searchEl.placeholder = "Filter by name…";
    el.appendChild(searchEl);
  }
  const chipsEl = document.createElement("div");
  chipsEl.className = "mg-chips";
  el.appendChild(chipsEl);
  const gridEl = document.createElement("div");
  gridEl.className = "mg-grid";
  el.appendChild(gridEl);
  const footerEl = document.createElement("div");
  footerEl.className = "mg-inline-footer";
  const statusEl = document.createElement("span");
  statusEl.className = "mg-status";
  const countEl = document.createElement("span");
  countEl.className = "mg-count";
  footerEl.append(statusEl, countEl);
  el.appendChild(footerEl);
  const setBusy = opts.setBusy ?? ((b) => {
    gridEl.style.opacity = b ? "0.5" : "";
  });
  const setStatus = opts.setStatus ?? ((s) => {
    statusEl.textContent = s;
  });
  function setCount(visible, total) {
    countEl.textContent = `${visible} / ${total}`;
  }
  const onSearchInput = () => {
    state.query = searchEl.value.trim();
    renderGrid();
  };
  searchEl.addEventListener("input", onSearchInput);
  const onChipsClick = (e) => {
    const b = e.target.closest("[data-chip]");
    if (!b)
      return;
    state.chip = b.dataset.chip ?? "__all__";
    renderChips();
    renderGrid();
  };
  chipsEl.addEventListener("click", onChipsClick);
  const onGridClick = (e) => {
    const infoBtn = e.target.closest(".mg-info-btn");
    if (infoBtn) {
      e.stopPropagation();
      toggleDetail(infoBtn.closest(".mg-card"));
      return;
    }
    const card = e.target.closest(".mg-card");
    if (!card)
      return;
    select(card.dataset.value ?? "");
  };
  gridEl.addEventListener("click", onGridClick);
  function select(value) {
    state.currentValue = value;
    for (const c of gridEl.querySelectorAll(".mg-card.is-selected")) {
      c.classList.remove("is-selected");
    }
    const chosen = gridEl.querySelector(`.mg-card[data-value="${CSS.escape(value)}"]`);
    chosen?.classList.add("is-selected");
    opts.onSelect?.(value);
  }
  function chipLabel(chip) {
    if (chip === "__all__")
      return "All";
    if (chip === "__root__")
      return "(root)";
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
      if (chip === state.chip)
        b.classList.add("is-active");
      chipsEl.appendChild(b);
    }
  }
  function matchesChip(item) {
    if (state.chip === "__all__")
      return true;
    const top = topLevelSubfolder(item);
    if (state.chip === "__root__")
      return top === "";
    return top === state.chip;
  }
  function renderGrid() {
    gridEl.innerHTML = "";
    const inChip = state.items.filter(matchesChip);
    let rows;
    if (state.query) {
      const scored = [];
      for (const it of inChip) {
        const info = infoForItem(it, category);
        const ranked = fuzzyRank(state.query, [
          it.name,
          ...corpusFields(info).filter((f) => Boolean(f))
        ]);
        if (ranked)
          scored.push({ it, info, ranked });
      }
      scored.sort((a, b) => b.ranked.score - a.ranked.score);
      rows = scored;
    } else {
      rows = inChip.map((it) => ({
        it,
        info: infoForItem(it, category),
        ranked: { primaryMatches: [] }
      }));
    }
    for (const { it, info, ranked } of rows) {
      gridEl.appendChild(buildCard(it, ranked.primaryMatches, info));
    }
    if (!rows.length) {
      const empty = document.createElement("div");
      empty.className = "mg-empty";
      empty.textContent = state.items.length ? "No matching models." : "No models in this category.";
      gridEl.appendChild(empty);
    }
    setCount(rows.length, state.items.length);
  }
  function buildCard(item, matches, info) {
    const card = document.createElement("div");
    card.className = "mg-card";
    card.dataset.value = item.name;
    if (item.name === state.currentValue)
      card.classList.add("is-selected");
    const sub = (item.subfolder || "").replace(/\\/g, "/");
    const base = basenameOf(item.name, item.subfolder);
    const subEl = document.createElement("div");
    subEl.className = "mg-card-sub";
    subEl.textContent = sub ? `${sub}/` : " ";
    const nameEl = document.createElement("div");
    nameEl.className = "mg-card-name";
    nameEl.title = item.name;
    if (matches?.length) {
      const local = remapMatches(matches, item.subfolder, base.length);
      nameEl.appendChild(highlightMatches(base, local));
    } else {
      nameEl.textContent = base;
    }
    const infoBtn = document.createElement("button");
    infoBtn.type = "button";
    infoBtn.className = "mg-info-btn";
    infoBtn.textContent = "ⓘ";
    infoBtn.title = "Read embedded file metadata";
    const metaEl = document.createElement("div");
    metaEl.className = "mg-card-meta";
    metaEl.textContent = item.mtime ? new Date(item.mtime * 1000).toLocaleDateString() : "";
    card.append(infoBtn, subEl, nameEl);
    const badgesEl = buildBadges(info);
    if (badgesEl)
      card.append(badgesEl);
    if (info?.summary) {
      const sumEl = document.createElement("div");
      sumEl.className = "mg-card-summary";
      sumEl.textContent = info.summary;
      card.append(sumEl);
    }
    card.append(metaEl);
    const cached = META_CACHE.get(metaKey(category, item.name));
    if (cached) {
      card.classList.add("mg-expanded");
      card.append(buildDetail(cached));
    }
    return card;
  }
  function buildBadges(info) {
    if (!info)
      return null;
    const wrap = document.createElement("div");
    wrap.className = "mg-badges";
    const add = (text, cls) => {
      if (!text)
        return;
      const b = document.createElement("span");
      b.className = `mg-badge ${cls}`;
      b.textContent = text;
      wrap.appendChild(b);
    };
    add(info.base, "mg-badge-base");
    if (info.family && info.family !== info.base)
      add(info.family, "mg-badge-family");
    add(info.type, "mg-badge-type");
    return wrap.childElementCount ? wrap : null;
  }
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
    if (meta.base)
      rows.push(["Base", String(meta.base)]);
    if (meta.title)
      rows.push(["Title", String(meta.title)]);
    if (meta.network_module)
      rows.push(["Network", String(meta.network_module)]);
    if (meta.rank)
      rows.push(["Rank", meta.alpha ? `${meta.rank} / α ${meta.alpha}` : String(meta.rank)]);
    else if (meta.alpha)
      rows.push(["Alpha", String(meta.alpha)]);
    if (meta.resolution)
      rows.push(["Trained", String(meta.resolution)]);
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
  function toggleDetail(card) {
    if (!card)
      return;
    const existing = card.querySelector(".mg-detail");
    if (existing) {
      existing.remove();
      card.classList.remove("mg-expanded");
      return;
    }
    card.classList.add("mg-expanded");
    const name = card.dataset.value ?? "";
    const placeholder = document.createElement("div");
    placeholder.className = "mg-detail mg-detail-loading";
    placeholder.textContent = "Reading metadata…";
    card.appendChild(placeholder);
    fetchMeta(category, name).then((meta) => {
      if (!placeholder.isConnected)
        return;
      placeholder.replaceWith(buildDetail(meta));
    });
  }
  function revealCurrentValueMeta() {
    if (!state.currentValue)
      return;
    fetchMeta(category, state.currentValue).then((meta) => {
      if (!meta)
        return;
      const card = gridEl.querySelector(".mg-card.is-selected");
      if (card && !card.querySelector(".mg-detail")) {
        card.classList.add("mg-expanded");
        card.append(buildDetail(meta));
      }
    });
  }
  function load() {
    setBusy(true);
    setStatus("Loading…");
    Promise.all([loadCorpus(), fetchListing(category)]).then(([, items]) => {
      state.items = items;
      state.chips = subfolderChips(items);
      setStatus("");
    }).catch((e) => {
      console.warn(`[${EXT_NAME2}] list failed for ${category}`, e);
      notify({
        severity: "error",
        summary: "Model listing failed",
        detail: `${e.message}`
      });
      state.items = [];
      state.chips = [];
      setStatus(`Error: ${e.message}`);
    }).finally(() => {
      setBusy(false);
      renderChips();
      renderGrid();
      revealCurrentValueMeta();
    });
  }
  function destroy() {
    searchEl.removeEventListener("input", onSearchInput);
    chipsEl.removeEventListener("click", onChipsClick);
    gridEl.removeEventListener("click", onGridClick);
    el.remove();
  }
  return {
    el,
    chipsEl,
    gridEl,
    countEl,
    getValue: () => state.currentValue,
    hasChanged: () => state.currentValue !== initialValue,
    focus: () => searchEl.focus(),
    destroy,
    load
  };
}
function commitToWidget(widget, node, value) {
  try {
    const values = widget.options?.values;
    if (Array.isArray(values) && !values.includes(value)) {
      values.push(value);
    }
    widget.value = value;
    try {
      widget.callback?.call(widget, value, app.canvas, node);
    } catch (e) {
      console.warn(`[${EXT_NAME2}] widget callback threw`, e);
    }
    node?.setDirtyCanvas?.(true, true);
    app.graph?.setDirtyCanvas?.(true, true);
  } catch (e) {
    console.warn(`[${EXT_NAME2}] commit failed`, e);
  }
}
function openPicker(widget, node) {
  const category = categoryForWidget(widget);
  if (!category)
    return;
  const modal = openModalShell({
    title: "Choose model",
    subtitle: `(${widget.name})`,
    placeholder: "Filter by name…",
    width: "min(1100px, calc(100vw - 16px))",
    height: "min(88vh, 820px)",
    footerLeftHTML: "<kbd>Esc</kbd> close · tap a card to select",
    footerRightHTML: ""
  });
  const view = createGallery({
    category,
    initialValue: (widget.value ?? "").toString(),
    searchEl: modal.searchEl,
    setBusy: modal.setBusy,
    setStatus: modal.setStatus,
    onSelect: (value) => {
      commitToWidget(widget, node, value);
      view.destroy();
      modal.close();
    }
  });
  modal.toolbarEl.appendChild(view.chipsEl);
  modal.bodyEl.appendChild(view.gridEl);
  modal.footerEl.appendChild(view.countEl);
  view.load();
}
function tooltipName(value) {
  return (value ?? "").toString().replace(/\\/g, "/").split("/").pop() ?? "";
}
function refreshWidgetTooltip(widget) {
  const category = categoryForWidget(widget);
  if (!category)
    return;
  const value = (widget.value ?? "").toString();
  widget.options = widget.options || {};
  if (widget._mgOrigTooltip === undefined)
    widget._mgOrigTooltip = widget.options.tooltip;
  const info = lookup(CORPUS, value, category);
  const tip = formatTooltip(tooltipName(value), info);
  const apply = (text) => {
    const t = text || widget._mgOrigTooltip;
    if (widget.options)
      widget.options.tooltip = t;
    widget.tooltip = t;
  };
  apply(tip);
  fetchMeta(category, value).then((meta) => {
    if (!meta)
      return;
    if ((widget.value ?? "").toString() !== value)
      return;
    apply(formatTooltip(tooltipName(value), { ...info || {}, ...meta }));
  });
}
function refreshAllTooltips() {
  const graph = app?.graph;
  for (const node of graph?._nodes ?? []) {
    for (const w of node.widgets ?? []) {
      if (w._modelGalleryPatched) {
        try {
          refreshWidgetTooltip(w);
        } catch (e) {
          console.warn(`[${EXT_NAME2}] tooltip refresh failed`, e);
        }
      }
    }
  }
}
function enhanceNode(node) {
  for (const w of node?.widgets ?? []) {
    if (!categoryForWidget(w))
      continue;
    if (!isComboWidget(w))
      continue;
    if (w._modelGalleryPatched)
      continue;
    w._modelGalleryPatched = true;
    try {
      refreshWidgetTooltip(w);
    } catch (e) {
      console.warn(`[${EXT_NAME2}] tooltip init failed`, e);
    }
    const origCb = w.callback;
    w.callback = function(value, ...rest) {
      const r = origCb ? origCb.call(this, value, ...rest) : undefined;
      try {
        refreshWidgetTooltip(w);
      } catch (e) {
        console.warn(`[${EXT_NAME2}] tooltip refresh failed`, e);
      }
      return r;
    };
    patchWidgetPointer(w, (_pointer, ownerNode) => {
      openPicker(w, ownerNode || node);
      return true;
    });
  }
}
var PICKER_CSS = `
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
/* Inline field-provider layout: the gallery mounted in a kit editor's field
   row (no modal shell chrome). Renders its own search box + footer. */
.mg-inline {
    display: flex;
    flex-direction: column;
    gap: 8px;
}
.mg-search {
    box-sizing: border-box;
    width: 100%;
    /* >=16px avoids iOS focus zoom (touch-first). */
    font-size: 16px;
    padding: 8px 10px;
    background: #21212a;
    color: #e8e8ea;
    border: 1px solid #3a3a44;
    border-radius: 6px;
    font-family: inherit;
}
.mg-search:focus {
    outline: none;
    border-color: #6ba6ff;
}
.mg-inline-footer {
    display: flex;
    justify-content: space-between;
    gap: 8px;
    font-size: 11px;
    color: #888;
}
.mg-status {
    font-style: italic;
}
`;
function ensureStyle3() {
  if (document.getElementById(STYLE_ID3))
    return;
  const s = document.createElement("style");
  s.id = STYLE_ID3;
  s.textContent = PICKER_CSS;
  document.head.appendChild(s);
}
try {
  app.registerExtension({
    name: "comfy.model-gallery",
    async setup() {
      await loadCorpus();
      try {
        refreshAllTooltips();
      } catch (e) {
        console.warn(`[${EXT_NAME2}] initial tooltip pass failed`, e);
      }
    },
    async nodeCreated(node) {
      try {
        enhanceNode(node);
      } catch (e) {
        console.warn(`[${EXT_NAME2}] nodeCreated enhance failed`, e);
      }
    },
    async loadedGraphNode(node) {
      try {
        enhanceNode(node);
      } catch (e) {
        console.warn(`[${EXT_NAME2}] loadedGraphNode enhance failed`, e);
      }
    }
  });
} catch (e) {
  console.warn(`[${EXT_NAME2}] registerExtension failed`, e);
}
try {
  registerFieldProvider({
    id: "comfyui-model-gallery:combo",
    priority: 10,
    match: (widget) => {
      const w = widget;
      return categoryForWidget(w) !== null && isComboWidget(w);
    },
    create: ({ widget, initialValue }) => {
      const w = widget;
      const view = createGallery({
        category: categoryForWidget(w) ?? "",
        initialValue: (initialValue ?? w.value ?? "").toString()
      });
      view.load();
      return {
        el: view.el,
        getValue: () => view.getValue(),
        hasChanged: () => view.hasChanged(),
        focus: () => view.focus(),
        destroy: () => view.destroy()
      };
    }
  });
} catch (e) {
  console.warn(`[${EXT_NAME2}] field provider registration failed`, e);
}
export {
  topLevelSubfolder,
  subfolderChips,
  remapMatches,
  isComboWidget,
  categoryForWidget,
  basenameOf,
  WIDGET_CATEGORY
};
