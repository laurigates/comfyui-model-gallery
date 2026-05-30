import { describe, expect, it } from "vitest";
import { fuzzyRank } from "../../web/js/modal-fuzzy.js";
import {
  basenameOf,
  categoryForWidget,
  isComboWidget,
  remapMatches,
  subfolderChips,
  topLevelSubfolder,
  WIDGET_CATEGORY,
} from "../../web/js/model-gallery.js";

// modal-fuzzy is reused verbatim — one smoke assertion keeps a tripwire on it.
describe("modal-fuzzy (reused)", () => {
  it("scores a subsequence match and returns null for a non-match", () => {
    const hit = fuzzyRank("eul", ["euler"]);
    expect(hit).not.toBeNull();
    expect(hit.score).toBeGreaterThan(0);
    expect(fuzzyRank("zzz", ["euler"])).toBeNull();
  });
});

describe("categoryForWidget", () => {
  it("maps known model-combo widget names to folder_paths categories", () => {
    expect(categoryForWidget({ name: "lora_name" })).toBe("loras");
    expect(categoryForWidget({ name: "ckpt_name" })).toBe("checkpoints");
    expect(categoryForWidget({ name: "vae_name" })).toBe("vae");
    expect(categoryForWidget({ name: "control_net_name" })).toBe("controlnet");
    expect(categoryForWidget({ name: "unet_name" })).toBe("diffusion_models");
    expect(categoryForWidget({ name: "upscale_model" })).toBe("upscale_models");
    expect(categoryForWidget({ name: "clip_vision_name" })).toBe("clip_vision");
    expect(categoryForWidget({ name: "style_model_name" })).toBe("style_models");
  });

  it("maps every numbered clip slot to the clip category", () => {
    for (const n of ["clip_name", "clip_name1", "clip_name2", "clip_name3", "clip_name4"]) {
      expect(categoryForWidget({ name: n })).toBe("clip");
    }
  });

  it("returns null for unhandled widgets (defer to native combo)", () => {
    expect(categoryForWidget({ name: "sampler_name" })).toBeNull();
    expect(categoryForWidget({ name: "seed" })).toBeNull();
    expect(categoryForWidget({})).toBeNull();
    expect(categoryForWidget(null)).toBeNull();
  });

  it("every mapped category is a non-empty string", () => {
    for (const cat of WIDGET_CATEGORY.values()) {
      expect(typeof cat).toBe("string");
      expect(cat.length).toBeGreaterThan(0);
    }
  });
});

describe("isComboWidget", () => {
  it("is true only for widgets carrying an options.values array", () => {
    expect(isComboWidget({ options: { values: ["a.safetensors"] } })).toBe(true);
    expect(isComboWidget({ options: { values: [] } })).toBe(true);
    expect(isComboWidget({ options: {} })).toBe(false);
    expect(isComboWidget({ options: { values: "a" } })).toBe(false);
    expect(isComboWidget({})).toBe(false);
    expect(isComboWidget(null)).toBe(false);
  });
});

describe("topLevelSubfolder", () => {
  it("returns the first path segment, or '' for a top-level file", () => {
    expect(topLevelSubfolder({ subfolder: "" })).toBe("");
    expect(topLevelSubfolder({ subfolder: "flux" })).toBe("flux");
    expect(topLevelSubfolder({ subfolder: "flux/realism" })).toBe("flux");
    expect(topLevelSubfolder({ subfolder: "a\\b" })).toBe("a");
    expect(topLevelSubfolder({})).toBe("");
  });
});

describe("subfolderChips", () => {
  it("returns [] when every entry is top-level (no chips needed)", () => {
    const items = [{ subfolder: "" }, { subfolder: "" }];
    expect(subfolderChips(items)).toEqual([]);
  });

  it("leads with All and sorts distinct top-level subfolders", () => {
    const items = [{ subfolder: "sdxl" }, { subfolder: "flux" }, { subfolder: "flux/sub" }];
    expect(subfolderChips(items)).toEqual(["__all__", "flux", "sdxl"]);
  });

  it("adds a root chip when loose top-level files coexist with subfolders", () => {
    const items = [{ subfolder: "" }, { subfolder: "flux" }];
    expect(subfolderChips(items)).toEqual(["__all__", "__root__", "flux"]);
  });
});

describe("basenameOf", () => {
  it("returns the name verbatim for a top-level file (no subfolder)", () => {
    expect(basenameOf("model.safetensors", "")).toBe("model.safetensors");
    expect(basenameOf("model.safetensors", undefined)).toBe("model.safetensors");
  });

  it("strips the subfolder prefix off a nested name", () => {
    expect(basenameOf("flux/realism.safetensors", "flux")).toBe("realism.safetensors");
    expect(basenameOf("a/b/c.ckpt", "a/b")).toBe("c.ckpt");
  });

  it("normalises Windows backslashes before stripping", () => {
    expect(basenameOf("flux\\realism.safetensors", "flux")).toBe("realism.safetensors");
    expect(basenameOf("a\\b\\c.ckpt", "a\\b")).toBe("c.ckpt");
  });

  it("leaves the full name intact when subfolder is not actually a prefix", () => {
    // Defensive: a mismatched subfolder must not slice into the combo value.
    expect(basenameOf("other/x.safetensors", "flux")).toBe("other/x.safetensors");
  });

  it("never throws on a null/empty name", () => {
    expect(basenameOf(null, "flux")).toBe("");
    expect(basenameOf("", "")).toBe("");
  });
});

describe("remapMatches", () => {
  it("returns [] when there are no matches", () => {
    expect(remapMatches([], "flux", 10)).toEqual([]);
    expect(remapMatches(undefined, "flux", 10)).toEqual([]);
  });

  it("passes indices through unchanged for a top-level file", () => {
    expect(remapMatches([0, 1, 2], "", 5)).toEqual([0, 1, 2]);
  });

  it("subtracts the subfolder-prefix length (subfolder + '/')", () => {
    // "flux/realism": prefix length 5 ("flux" + "/"). Match at index 5 (the
    // 'r' of realism) maps to basename index 0.
    expect(remapMatches([5, 6, 7], "flux", 7)).toEqual([0, 1, 2]);
  });

  it("drops indices that landed in the subfolder portion", () => {
    // Matches at 0..3 are inside "flux"; only 5 survives -> basename index 0.
    expect(remapMatches([0, 1, 5], "flux", 7)).toEqual([0]);
  });

  it("drops indices that fall past the basename range", () => {
    // baseLength 3, so remapped index 3 (out of range) is dropped.
    expect(remapMatches([5, 8], "flux", 3)).toEqual([0]);
  });

  it("round-trips with basenameOf: highlight indices stay on the basename", () => {
    // A fuzzyRank over the full relative name yields indices into that name;
    // remapMatches must land them on the basename basenameOf produces.
    const name = "flux/euler.safetensors";
    const sub = "flux";
    const ranked = fuzzyRank("eul", [name]);
    expect(ranked).not.toBeNull();
    const base = basenameOf(name, sub);
    expect(base).toBe("euler.safetensors");
    const local = remapMatches(ranked.primaryMatches, sub, base.length);
    // Every remapped index must point at the matched character in the basename.
    for (const i of local) {
      expect(i).toBeGreaterThanOrEqual(0);
      expect(i).toBeLessThan(base.length);
    }
    // "eul" matches the leading e-u-l of "euler".
    expect(local).toEqual([0, 1, 2]);
  });
});
