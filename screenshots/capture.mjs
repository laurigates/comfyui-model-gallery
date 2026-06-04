// Playwright driver for the README screenshot.
//
// Drives ComfyUI's frontend through the pack's real public surface:
// loads a single CheckpointLoaderSimple workflow, then opens the model
// gallery modal over its `ckpt_name` combo (the pack's intercept) and
// screenshots the dialog. The grid is populated from the /model_gallery/
// list endpoint, which enumerates the placeholder model files the Docker
// build seeded into models/ (see seed_models.py).
//
// Direct widget invocation is intentional: clicking the canvas at computed
// coords is fragile (Vue layout, ds scale, devicePixelRatio interact), and
// `widget.onPointerDown(pointer, node, canvas)` is the same public surface
// the pack hooks into — calling it directly exercises the exact code path a
// real tap would.

import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const HERE = dirname(fileURLToPath(import.meta.url));
const WORKFLOW_PATH = resolve(HERE, "workflow.json");
const OUT_DIR = process.env.OUT_DIR || "/out";
const BASE_URL = process.env.COMFYUI_URL || "http://127.0.0.1:8188/";
// Optional: type a filter into the modal search to show the fuzzy-match
// state. Empty (default) leaves the full grid visible.
const PICKER_QUERY = process.env.PICKER_QUERY || "";

async function dismissStartupDialog(page) {
  // A fresh ComfyUI profile opens the "Workflow Templates / Getting
  // Started" PrimeVue dialog (.p-dialog-mask) over the canvas. Close it
  // so it doesn't composite on top of our screenshot.
  await page.keyboard.press("Escape");
  await page.waitForTimeout(150);
  await page.evaluate(() => {
    for (const el of document.querySelectorAll(".p-dialog-mask")) el.remove();
  });
}

async function main() {
  const workflow = JSON.parse(await readFile(WORKFLOW_PATH, "utf8"));

  const browser = await chromium.launch({
    args: ["--font-render-hinting=none"],
  });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 2,
  });
  const page = await context.newPage();

  page.on("console", (msg) => {
    const t = msg.type();
    if (t === "error" || t === "warning") {
      console.log(`[page:${t}] ${msg.text()}`);
    }
  });

  console.log(`Navigating to ${BASE_URL}…`);
  await page.goto(BASE_URL, { waitUntil: "networkidle" });

  await page.waitForFunction(
    () => window.app && window.app.graph && Array.isArray(window.app.graph._nodes),
    null,
    { timeout: 30_000 },
  );

  console.log("Loading single CheckpointLoaderSimple workflow…");
  await page.evaluate((wf) => {
    // clean=true wipes the default workflow so we end with just our node.
    window.app.loadGraphData(wf, true);
  }, workflow);

  await page.waitForFunction(() => window.app.graph._nodes.length === 1, null, {
    timeout: 10_000,
  });

  await dismissStartupDialog(page);

  // Wait until the pack has patched the ckpt_name combo widget.
  await page.waitForFunction(
    () => {
      const node = window.app.graph._nodes[0];
      const w = node?.widgets?.find((x) => x.name === "ckpt_name");
      return w && w._modelGalleryPatched === true;
    },
    null,
    { timeout: 15_000 },
  );

  // Force a canvas redraw so widget.last_y and friends are populated.
  await page.evaluate(() => {
    window.app.canvas?.setDirty?.(true, true);
    window.app.canvas?.draw?.(true, true);
  });

  console.log("Opening model gallery via widget.onPointerDown…");
  await page.evaluate(() => {
    const node = window.app.graph._nodes[0];
    const widget = node.widgets.find((w) => w.name === "ckpt_name");
    widget.onPointerDown({}, node, window.app.canvas);
  });

  const dialog = page.locator(".cmp-dialog");
  await dialog.waitFor({ state: "visible", timeout: 10_000 });

  // Wait for the grid to populate from the /list endpoint (at least one card).
  await page.waitForFunction(
    () => document.querySelector(".cmp-dialog .mg-card"),
    null,
    { timeout: 10_000 },
  );

  if (PICKER_QUERY) {
    const search = dialog.locator(".cmp-search");
    await search.waitFor({ state: "visible", timeout: 5_000 });
    await search.fill(PICKER_QUERY);
    await page.waitForFunction(
      () => document.querySelectorAll(".cmp-dialog .mg-card").length > 0,
      null,
      { timeout: 5_000 },
    );
  }

  await page.waitForTimeout(400);

  console.log(`Capturing ${OUT_DIR}/picker.png…`);
  await dialog.screenshot({ path: `${OUT_DIR}/picker.png` });

  await browser.close();
}

main().catch((err) => {
  console.error("capture failed:", err);
  process.exit(1);
});
