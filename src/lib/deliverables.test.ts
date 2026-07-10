import { describe, expect, it } from "vitest";
import { AUTO_SUBMIT_FROM, CREATOR_STATUSES, PROD_STATUSES } from "./deliverables";

describe("deliverable status sets", () => {
  it("auto-submit sources are real production states", () => {
    for (const s of AUTO_SUBMIT_FROM) expect(PROD_STATUSES).toContain(s);
  });

  it("auto-submit never regresses a staff-owned state", () => {
    expect(AUTO_SUBMIT_FROM).not.toContain("Approved");
    expect(AUTO_SUBMIT_FROM).not.toContain("Delivered");
    // …and never re-submits something already Submitted.
    expect(AUTO_SUBMIT_FROM).not.toContain("Submitted");
  });

  it("creators can set the state uploads auto-advance to", () => {
    expect(CREATOR_STATUSES).toContain("Submitted");
  });
});
