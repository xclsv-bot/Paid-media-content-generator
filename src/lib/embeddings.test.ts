import { describe, it, expect, afterEach } from "vitest";
import { cosine, embed, embeddingsEnabled, semanticDupThreshold } from "./embeddings";

describe("cosine", () => {
  it("is 1 for identical vectors and 0 for orthogonal", () => {
    expect(cosine([1, 2, 3], [1, 2, 3])).toBeCloseTo(1);
    expect(cosine([1, 0], [0, 1])).toBeCloseTo(0);
  });
  it("is -1 for opposite vectors", () => {
    expect(cosine([1, 1], [-1, -1])).toBeCloseTo(-1);
  });
  it("returns 0 for missing, empty, or mismatched-length inputs (never throws)", () => {
    expect(cosine(null, [1, 2])).toBe(0);
    expect(cosine([1, 2], undefined)).toBe(0);
    expect(cosine([], [])).toBe(0);
    expect(cosine([1, 2, 3], [1, 2])).toBe(0);
    expect(cosine([0, 0], [0, 0])).toBe(0);
  });
});

describe("semanticDupThreshold", () => {
  afterEach(() => {
    delete process.env.SEMANTIC_DUP_THRESHOLD;
  });
  it("defaults to 0.9 and honors a valid env override", () => {
    expect(semanticDupThreshold()).toBe(0.9);
    process.env.SEMANTIC_DUP_THRESHOLD = "0.85";
    expect(semanticDupThreshold()).toBe(0.85);
    process.env.SEMANTIC_DUP_THRESHOLD = "2"; // out of range → default
    expect(semanticDupThreshold()).toBe(0.9);
  });
});

describe("embed / embeddingsEnabled", () => {
  const saved = process.env.OPENAI_API_KEY;
  afterEach(() => {
    if (saved === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = saved;
  });
  it("degrades to null/disabled with no key (never throws)", async () => {
    delete process.env.OPENAI_API_KEY;
    expect(embeddingsEnabled()).toBe(false);
    await expect(embed("anything")).resolves.toBeNull();
  });
  it("returns null for empty input even with a key", async () => {
    process.env.OPENAI_API_KEY = "sk-test";
    await expect(embed("   ")).resolves.toBeNull();
  });
});
