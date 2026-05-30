// Model Gallery — ComfyUI frontend extension.
//
// Served at /extensions/comfyui-model-gallery/js/model-gallery.js — the pack directory
// name IS this URL segment. Do not rename the pack dir without syncing
// EXT_NAME below (used for log prefixes and any /model_gallery/ fetches).
//
// Pattern (shared with gallery-loader / sampler-info):
//   registerExtension -> enhance each node (on create AND on graph load) ->
//   wrap widget.onPointerDown on widgets matched BY NAME -> open an HTML
//   modal instead of the native LiteGraph control. Additive + mobile-first;
//   always chain to the original handler and fall back to the native control.
//   Requires the modern Vue frontend's onPointerDown hook
//   (comfyui-frontend-package >= 1.40).
//
// To add fuzzy search to the modal, import from ./modal-fuzzy.js:
//   import { fuzzyRank, highlightMatches } from "./modal-fuzzy.js";
//   fuzzyRank(query, [primaryField, ...otherFields]) -> { score, primaryMatches } | null

import { app } from "../../../scripts/app.js";
import { openModalShell } from "./modal-shell.js";

const EXT_NAME = "comfyui-model-gallery";

// Widgets this pack enhances, detected by NAME (generic across node packs).
// TODO: tune this set for the pack.
const TARGET_WIDGETS = new Set(["lora_name", "ckpt_name", "vae_name", "control_net_name", "unet_name", "clip_name", "clip_name1", "clip_name2", "style_model_name", "gligen_name", "upscale_model", "clip_vision_name"]);

function openPicker(widget, node) {
  // TODO: build the real modal body. This skeleton proves the interception
  // + modal-shell wiring works end to end. Use fuzzyRank for search.
  const body = document.createElement("div");
  body.textContent = `Model Gallery: picker for "${widget.name}" on ${node?.type} — implement me.`;

  openModalShell({
    title: widget.name,
    body,
    // search: (query) => { ... fuzzyRank over options, re-render rows ... },
    onClose: () => {},
  });
}

function enhanceNode(node) {
  for (const w of node?.widgets ?? []) {
    if (!TARGET_WIDGETS.has(w.name)) continue;
    if (w._modelGalleryPatched) continue; // guard against double-patching
    w._modelGalleryPatched = true;

    // Strategy A: wrap onPointerDown. Chain to the original first; only open
    // our modal if the original didn't consume the event.
    const origDown = w.onPointerDown;
    w.onPointerDown = function (pointer, ownerNode, canvas) {
      try {
        if (typeof origDown === "function") {
          const consumed = origDown.call(this, pointer, ownerNode, canvas);
          if (consumed) return consumed;
        }
        openPicker(w, ownerNode || node);
        return true; // consume — suppresses the native control
      } catch (e) {
        console.warn(`[${EXT_NAME}] picker open failed`, e);
        return false; // fall back to native on error
      }
    };

    // Strategy B safety net: if a future frontend drops the onPointerDown
    // hook, an explicit button widget keeps the modal reachable. Uncomment
    // if this pack depends on the modal always being openable:
    // node.addWidget("button", `\u{1F50D} ${w.name}`, null, () => openPicker(w, node));
  }
}

app.registerExtension({
  name: "comfy.model-gallery",
  // Handle freshly created nodes AND nodes restored from a saved graph.
  async nodeCreated(node) {
    enhanceNode(node);
  },
  async loadedGraphNode(node) {
    enhanceNode(node);
  },
});
