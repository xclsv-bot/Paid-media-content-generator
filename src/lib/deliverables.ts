// Deliverable production states — shared by the UI dropdowns and the API's
// authorization allowlists so they can't drift apart.
export const PROD_STATUSES: readonly string[] = [
  "Assigned",
  "In production",
  "Submitted",
  "In revision",
  "Approved",
  "Delivered",
];

// Approving a cut and publishing it to the client ("Delivered" is what the
// client-portal RLS keys on) are staff calls; a creator moves work between
// the production states only.
export const CREATOR_STATUSES: readonly string[] = ["In production", "Submitted", "In revision"];

// Statuses a creator's fresh upload auto-advances to "Submitted" from
// (POST /api/videos). "In revision" → "Submitted" is the natural re-submit
// after change requests; "Approved"/"Delivered" are staff-owned and a
// creator upload must never regress them.
export const AUTO_SUBMIT_FROM: readonly string[] = ["Assigned", "In production", "In revision"];
