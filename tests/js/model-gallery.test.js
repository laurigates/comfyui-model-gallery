import { describe, expect, it } from "vitest";
import { fuzzyRank } from "../../web/js/modal-fuzzy.js";

// Smoke test so `npm test` is green from the first commit. Exercises the
// copied fuzzy matcher; replace with real tests of this pack's pure helpers
// as they land. fuzzyRank(query, [primary, ...rest]) -> {score, primaryMatches} | null.
describe("comfyui-model-gallery harness", () => {
  it("scores a subsequence match and returns null for a non-match", () => {
    const hit = fuzzyRank("eul", ["euler"]);
    expect(hit).not.toBeNull();
    expect(hit.score).toBeGreaterThan(0);

    const miss = fuzzyRank("zzz", ["euler"]);
    expect(miss).toBeNull();
  });
});
