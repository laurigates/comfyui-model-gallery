// model-corpus.ts — pattern-matched metadata for model files.
//
// The model picker lists arbitrary user filenames (folder_paths enumerates
// whatever is on disk), so unlike sampler-info — where the vocabulary is a
// fixed, enumerable set of sampler/scheduler tokens — a model corpus cannot
// key on exact names. It matches by PATTERN against the basename instead:
// "juggernautXL_v9.safetensors" -> Juggernaut / base SDXL, "flux1-dev.sft"
// -> Flux.1, "4x-UltraSharp.pth" -> ESRGAN 4x upscaler, and so on.
//
// Two match tiers, exact-wins-over-prefix (mirrors sampler-info's shape):
//   - exact:  lowercased full basename -> info (canonical distributed files).
//   - prefix: ordered list of {match: regex} tested against the lowercased
//     basename; FIRST match wins, so order specific models before the
//     generic base-architecture families they belong to. An entry may carry
//     `categories` to restrict it to certain folder_paths categories (e.g. a
//     VAE-only or upscaler-only pattern), avoiding cross-category false hits.
//
// Everything here is pure (no DOM, no fetch) so the fiddly regex/lookup math
// is unit-testable; model-gallery.ts owns loading and rendering.

const EXT_NAME = "comfyui-model-gallery";

/** A single corpus entry — describes one model file or family. */
export interface CorpusEntry {
  base?: string;
  family?: string;
  type?: string;
  summary?: string;
  good_for?: string;
  notes?: string;
  [key: string]: unknown;
}

/** A raw prefix entry as authored in the JSON corpus (regex source string). */
interface RawPrefixEntry extends CorpusEntry {
  match: string;
  categories?: string[];
}

/** A compiled prefix entry — the regex source replaced with a live RegExp. */
export interface PrefixEntry extends CorpusEntry {
  match: string;
  categories?: string[];
  re: RegExp;
}

/** The raw corpus document, as parsed from the JSON file. */
interface RawCorpus {
  exact?: Record<string, CorpusEntry>;
  prefix?: RawPrefixEntry[];
}

/** The lookup-ready corpus, with prefix regexes precompiled. */
export interface CompiledCorpus {
  exact: Record<string, CorpusEntry>;
  prefix: PrefixEntry[];
}

/**
 * Compile a raw corpus document (parsed JSON) into a lookup-ready shape:
 * precompile each prefix entry's regex once, dropping any that fail to
 * compile. Regexes are matched case-insensitively (the `i` flag) so corpus
 * authors can write lowercase patterns and still match mixed-case filenames.
 */
export function compileCorpus(raw: RawCorpus | null | undefined): CompiledCorpus {
  const prefix = (raw?.prefix ?? [])
    .map((p) => ({ ...p, re: safeRegex(p.match) }))
    .filter((p): p is PrefixEntry => p.re !== null);
  return { exact: raw?.exact ?? {}, prefix };
}

/**
 * Build a case-insensitive RegExp, returning null (with a warning) on a bad
 * pattern so one malformed corpus entry can't break the whole lookup table.
 */
export function safeRegex(pattern: string): RegExp | null {
  try {
    return new RegExp(pattern, "i");
  } catch (e) {
    console.warn(`[${EXT_NAME}] bad regex in corpus: ${pattern}`, e);
    return null;
  }
}

/**
 * The bare filename, lowercased, with any subfolder prefix and Windows
 * backslashes stripped. folder_paths returns names like "flux/dev.safetensors";
 * the corpus describes the file, not the folder, so match on the basename.
 */
export function corpusKey(name: unknown): string {
  if (!name || typeof name !== "string") return "";
  const norm = name.replace(/\\/g, "/");
  const idx = norm.lastIndexOf("/");
  return (idx < 0 ? norm : norm.slice(idx + 1)).toLowerCase();
}

/**
 * Resolve a model name to its corpus entry, or null when nothing matches
 * (then the card/tooltip just shows the bare filename — additive, never
 * fabricated). Exact basename match wins; otherwise the first prefix regex
 * that matches AND is allowed for `category` wins.
 */
export function lookup(
  corpus: CompiledCorpus | null | undefined,
  name: string,
  category?: string,
): CorpusEntry | null {
  if (!corpus) return null;
  const key = corpusKey(name);
  if (!key) return null;
  const exact = corpus.exact[key];
  if (exact) return exact;
  for (const p of corpus.prefix) {
    if (p.categories && category && !p.categories.includes(category)) continue;
    if (p.re.test(key)) return p;
  }
  return null;
}

/**
 * The corpus fields a query should be able to fuzzy-match against (secondary
 * to the filename itself). Lets a user filter "sdxl" or "anime" or "upscale"
 * and find files whose metadata — not their cryptic name — says so. Falsy
 * fields are dropped by the caller's fuzzy ranker.
 */
export function corpusFields(info: CorpusEntry | null): (string | undefined)[] {
  if (!info) return [];
  return [info.base, info.family, info.type, info.summary, info.good_for];
}

/**
 * Render the corpus entry as a multi-line tooltip string (for the widget's
 * native hover / long-press tooltip on the currently-selected value). Mirrors
 * sampler-info's formatter. Returns "" when there's nothing worth showing.
 */
export function formatTooltip(name: string, info: CorpusEntry | null): string {
  if (!info) return "";
  const headerBits = [name];
  if (info.base) headerBits.push(info.base);
  if (info.family && info.family !== info.base) headerBits.push(info.family);
  const lines = [headerBits.join(" · "), ""];
  if (info.summary) lines.push(info.summary);
  if (info.good_for) lines.push("", `Good for: ${info.good_for}`);
  if (info.notes) lines.push("", `Note: ${info.notes}`);
  return lines.join("\n").trim();
}
