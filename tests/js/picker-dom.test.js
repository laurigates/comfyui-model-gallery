// @vitest-environment jsdom
//
// DOM-level contract for the picker modal. The pure-helper suites (corpus
// lookup, formatting, fuzzy ranking) cannot see any of this: the shell's
// structure, which element owns scrolling, or whether teardown actually runs.
//
// This pack came out of a cross-pack UX audit as the family's REFERENCE for
// shell delegation — it owns no chrome, re-parenting its parts into the shell's
// named slots. These tests pin that, so a future refactor cannot quietly
// re-hand-roll what the kit provides.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openPicker } from "../../src/model-gallery.ts";

const ITEMS = [
  { name: "flux/realism.safetensors", subfolder: "flux", size: 1024 },
  { name: "anime-style.safetensors", subfolder: "", size: 2048 },
];

/** Route each endpoint the gallery touches; everything else 404s loudly. */
function stubFetch() {
  return vi.fn(async (url) => {
    const u = String(url);
    if (u.includes("/list")) {
      return { ok: true, json: async () => ({ ok: true, items: ITEMS }) };
    }
    if (u.includes("models.json")) {
      return { ok: true, json: async () => ({}) };
    }
    // meta / hash: answer "nothing known", which is a supported state.
    return { ok: true, json: async () => ({ ok: false }) };
  });
}

const widget = (value = "") => ({ name: "lora_name", value, options: { values: [] } });
const node = () => ({ widgets: [], setDirtyCanvas() {} });

/** Let the gallery's load() promise chain settle. */
const settle = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  document.body.replaceChildren();
  document.head.replaceChildren();
  globalThis.fetch = stubFetch();
});

afterEach(() => {
  for (const el of document.querySelectorAll(".cmp-backdrop, .cmp-dialog")) el.remove();
});

async function open(w = widget()) {
  openPicker(w, node());
  await settle();
  const dialog = document.querySelector(".cmp-dialog");
  expect(dialog, "the shell dialog should be on screen").not.toBeNull();
  return dialog;
}

describe("the picker delegates its chrome to the shell", () => {
  it("renders the shell's own header, search and footer", async () => {
    const dialog = await open();
    expect(dialog.querySelector(".cmp-title")).not.toBeNull();
    expect(dialog.querySelector(".cmp-search")).not.toBeNull();
    expect(dialog.querySelector(".cmp-close")).not.toBeNull();
    expect(dialog.querySelector(".cmp-footer")).not.toBeNull();
  });

  it("re-parents its own parts into the shell's slots", async () => {
    const dialog = await open();
    expect(dialog.querySelector(".cmp-toolbar .mg-chips")).not.toBeNull();
    expect(dialog.querySelector(".cmp-body .mg-grid")).not.toBeNull();
  });

  it("opens exactly one dialog, and one backdrop", async () => {
    await open();
    expect(document.querySelectorAll(".cmp-dialog")).toHaveLength(1);
    expect(document.querySelectorAll(".cmp-backdrop")).toHaveLength(1);
  });
});

describe("scroll ownership", () => {
  it("has exactly one scroll region, and it is the shell's", async () => {
    // The kit's contract: .cmp-body is the modal's single scroll region. A
    // nested scroller would compete for the same drag gesture on a phone.
    const dialog = await open();
    const scrollers = [dialog, ...dialog.querySelectorAll("*")]
      .filter((el) => /auto|scroll/.test(getComputedStyle(el).overflowY))
      .map((el) => el.className);
    expect(scrollers).toEqual(["cmp-body"]);
  });
});

describe("the listing renders", () => {
  it("paints a card per listed model", async () => {
    const dialog = await open();
    const cards = dialog.querySelectorAll(".mg-card");
    expect(cards).toHaveLength(ITEMS.length);
  });

  it("commits the exact combo value on tap and closes", async () => {
    const w = widget();
    const dialog = await open(w);
    dialog.querySelector('.mg-card[data-value="anime-style.safetensors"]').click();

    expect(w.value).toBe("anime-style.safetensors");
    expect(document.querySelector(".cmp-dialog")).toBeNull();
  });
});

describe("teardown runs on every exit path, not just selection", () => {
  it("detaches the grid listener when dismissed via the close button", async () => {
    // Regression: destroy() was called ONLY inside onSelect, so the close
    // button, the backdrop and Esc all left the view undestroyed. The shell
    // invokes onClose in a finally on every path — this asserts the pack
    // actually passes one.
    //
    // Observable because destroy() removes the delegated grid listener: after a
    // dismiss, a click that would otherwise commit must do nothing.
    const w = widget();
    const dialog = await open(w);
    const card = dialog.querySelector('.mg-card[data-value="anime-style.safetensors"]');

    dialog.querySelector(".cmp-close").click();
    expect(document.querySelector(".cmp-dialog")).toBeNull();

    card.click();
    expect(w.value).toBe("");
  });
});
