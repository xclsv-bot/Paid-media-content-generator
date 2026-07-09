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
