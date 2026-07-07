// The script rubric — the shared bar the checker scores against and the maker
// revises toward. Kept in one place so review + revise + (later) learnings agree.
//
// NOTE: the angle_fit guide's underlying thesis ("research is the edge; wins
// are the outcome of a process") is Outlier-specific product framing, not a
// generic template. rubricText() only parameterizes the brand-name literal —
// a client selling a genuinely different product needs a different angle_fit
// guide, which is a per-client content task, not handled here.
export const RUBRIC_CRITERIA = [
  {
    key: "hook",
    label: "Hook",
    guide:
      "The first 3 seconds must stop the scroll — a pattern-interrupt, a specific number, or a bold claim. Vague or slow openers fail.",
  },
  {
    key: "angle_fit",
    label: "Angle fit",
    guide:
      "Delivers on the concept's angle and family thesis ({{CLIENT}} = research is the edge; wins are the OUTCOME OF A PROCESS, never luck). The research/proof must be shown, not just asserted.",
  },
  {
    key: "compliance",
    label: "Compliance",
    guide:
      "Hard rules. No win/ROI guarantees or 'risk-free'. Show the process behind any $X→$Y result. Never name a competitor app unless approved in writing (attack the METHOD — last-5, free stat sites — not a brand). Don't lead with EV in broad acquisition. Respect any family-specific compliance note. 21+ / T&Cs where an offer appears.",
  },
  {
    key: "structure",
    label: "Structure",
    guide:
      "Clear beats — hook → value/proof → single CTA — timed to the format (typically ~15s, 9:16). No rambling; every line earns its place.",
  },
  {
    key: "clarity",
    label: "Clarity & CTA",
    guide:
      "Plain, concrete language a bettor would actually say. One unambiguous CTA (e.g. 7-day trial / research a pick free).",
  },
] as const;

export type CriterionKey = (typeof RUBRIC_CRITERIA)[number]["key"];

// Pass bar: every criterion >= 8, and compliance is a hard gate.
export const PASS_BAR = 8;

export function rubricText(displayName: string): string {
  return RUBRIC_CRITERIA
    .map((c) => `- ${c.label} (${c.key}): ${c.guide.replace("{{CLIENT}}", displayName)}`)
    .join("\n");
}
