import { describe, expect, it } from "vitest";
import {
  compileCorpus,
  corpusFields,
  corpusKey,
  formatBytes,
  formatParams,
  formatTooltip,
  lookup,
  safeRegex,
} from "../../src/model-corpus.ts";

describe("safeRegex", () => {
  it("compiles a valid pattern case-insensitively", () => {
    const re = safeRegex("sdxl");
    expect(re).toBeInstanceOf(RegExp);
    expect(re.flags).toContain("i");
    expect(re.test("MyModel_SDXL_v1")).toBe(true);
  });

  it("returns null on an invalid pattern instead of throwing", () => {
    expect(safeRegex("[unclosed")).toBeNull();
  });
});

describe("compileCorpus", () => {
  it("precompiles prefix regexes and drops the malformed ones", () => {
    const c = compileCorpus({
      exact: { "a.safetensors": { base: "SDXL" } },
      prefix: [{ match: "flux" }, { match: "[bad" }],
    });
    expect(c.exact["a.safetensors"].base).toBe("SDXL");
    expect(c.prefix).toHaveLength(1);
    expect(c.prefix[0].re).toBeInstanceOf(RegExp);
  });

  it("tolerates a missing/empty document", () => {
    expect(compileCorpus(undefined)).toEqual({ exact: {}, prefix: [] });
    expect(compileCorpus({})).toEqual({ exact: {}, prefix: [] });
  });
});

describe("corpusKey", () => {
  it("lowercases and strips the subfolder + backslashes", () => {
    expect(corpusKey("Flux/Dev.safetensors")).toBe("dev.safetensors");
    expect(corpusKey("a\\b\\Model.CKPT")).toBe("model.ckpt");
    expect(corpusKey("Plain.safetensors")).toBe("plain.safetensors");
  });

  it("is empty for falsy/non-string input", () => {
    expect(corpusKey("")).toBe("");
    expect(corpusKey(null)).toBe("");
    expect(corpusKey(42)).toBe("");
  });
});

describe("lookup", () => {
  const corpus = compileCorpus({
    exact: { "ae.safetensors": { base: "Flux.1", family: "ae" } },
    prefix: [
      { match: "juggernaut", base: "SDXL", family: "Juggernaut" },
      { match: "sdxl[ ._-]?vae", base: "SDXL", family: "SDXL VAE", categories: ["vae"] },
      { match: "sdxl", base: "SDXL", family: "Stable Diffusion XL" },
    ],
  });

  it("matches an exact basename (winning over prefix)", () => {
    expect(lookup(corpus, "ae.safetensors").family).toBe("ae");
    // Subfolder is stripped before the exact check.
    expect(lookup(corpus, "flux/ae.safetensors").family).toBe("ae");
  });

  it("falls back to the first matching prefix, case-insensitively", () => {
    expect(lookup(corpus, "juggernautXL_v9.safetensors").family).toBe("Juggernaut");
    expect(lookup(corpus, "someRandom_SDXL_merge.safetensors").family).toBe("Stable Diffusion XL");
  });

  it("honours category gating (first-match-wins respects order)", () => {
    // In the vae category the vae-specific pattern precedes the generic sdxl.
    expect(lookup(corpus, "sdxl_vae.safetensors", "vae").family).toBe("SDXL VAE");
    // Without the vae category, the gated entry is skipped -> generic sdxl.
    expect(lookup(corpus, "sdxl_vae.safetensors", "checkpoints").family).toBe(
      "Stable Diffusion XL",
    );
  });

  it("returns null when nothing matches", () => {
    expect(lookup(corpus, "totally-unknown-thing.safetensors")).toBeNull();
    expect(lookup(corpus, "")).toBeNull();
    expect(lookup(null, "x")).toBeNull();
  });
});

describe("corpusFields", () => {
  it("returns the searchable fields, [] for null", () => {
    const info = { base: "SDXL", family: "Pony", type: "ControlNet", summary: "s", good_for: "g" };
    expect(corpusFields(info)).toEqual(["SDXL", "Pony", "ControlNet", "s", "g"]);
    expect(corpusFields(null)).toEqual([]);
  });
});

describe("formatTooltip", () => {
  it("builds a multi-line tooltip with header + body", () => {
    const tip = formatTooltip("juggernautXL.safetensors", {
      base: "SDXL",
      family: "Juggernaut",
      summary: "Photoreal SDXL merge.",
      good_for: "Realism",
      notes: "Flux variant exists.",
    });
    expect(tip).toContain("juggernautXL.safetensors · SDXL · Juggernaut");
    expect(tip).toContain("Photoreal SDXL merge.");
    expect(tip).toContain("Good for: Realism");
    expect(tip).toContain("Note: Flux variant exists.");
  });

  it("does not repeat family when it equals base", () => {
    const tip = formatTooltip("x", { base: "SDXL", family: "SDXL", summary: "s" });
    expect(tip).toContain("x · SDXL");
    expect(tip).not.toContain("SDXL · SDXL");
  });

  it("returns '' when there is no info", () => {
    expect(formatTooltip("x", null)).toBe("");
  });
});

describe("formatBytes", () => {
  it("returns '' for null/undefined/negative", () => {
    expect(formatBytes(null)).toBe("");
    expect(formatBytes(undefined)).toBe("");
    expect(formatBytes(-1)).toBe("");
  });

  it("shows raw bytes under 1 KiB", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(512)).toBe("512 B");
  });

  it("uses whole KB and decimal MB/GB", () => {
    expect(formatBytes(2048)).toBe("2 KB");
    expect(formatBytes(5 * 1024 * 1024)).toBe("5.00 MB");
    expect(formatBytes(Math.round(6.46 * 1024 * 1024 * 1024))).toBe("6.46 GB");
  });
});

describe("formatParams", () => {
  it("returns '' for null/undefined/non-positive", () => {
    expect(formatParams(null)).toBe("");
    expect(formatParams(0)).toBe("");
  });

  it("scales to K/M/B/T", () => {
    expect(formatParams(512)).toBe("512");
    expect(formatParams(340_000_000)).toBe("340M");
    expect(formatParams(11_901_408_256)).toBe("11.9B");
    expect(formatParams(2_000_000_000_000)).toBe("2.00T");
  });
});
