import { describe, expect, it } from "vitest";
import { sourceRef, parseSourceRef, sourceRefTable, SOURCE_KINDS } from "@/lib/loop/sourceRef";

describe("sourceRef — one format, round-trips cleanly", () => {
  it("builds and parses back every kind", () => {
    for (const kind of SOURCE_KINDS) {
      const ref = sourceRef(kind, "abc123");
      expect(ref).toBe(`${kind}:abc123`);
      expect(parseSourceRef(ref)).toEqual({ kind, key: "abc123", raw: ref });
    }
  });

  it("splits on the first colon only (family names may contain colons)", () => {
    const ref = sourceRef("explore", "Player: The Sequel");
    expect(parseSourceRef(ref)).toEqual({ kind: "explore", key: "Player: The Sequel", raw: ref });
  });

  it("rejects unknown kinds, bare strings, and malformed input", () => {
    expect(parseSourceRef("cr_win_1")).toBeNull(); // legacy bare id — no prefix
    expect(parseSourceRef("bogus:x")).toBeNull(); // unknown kind
    expect(parseSourceRef(":x")).toBeNull(); // empty kind
    expect(parseSourceRef("golden:")).toBeNull(); // empty key
    expect(parseSourceRef("")).toBeNull();
  });

  it("maps refs to their DURABLE retrieval table (not the prunable stores)", () => {
    // creative-kind refs resolve against immutable `creatives`, slot-kind against
    // `concept_families` — never the golden/bad example stores, which get pruned.
    expect(sourceRefTable("golden")).toBe("creatives");
    expect(sourceRefTable("loser")).toBe("creatives");
    expect(sourceRefTable("rejection")).toBe("creatives");
    expect(sourceRefTable("winner")).toBe("creatives");
    expect(sourceRefTable("explore")).toBe("concept_families");
    expect(sourceRefTable("validating")).toBe("concept_families");
  });
});
