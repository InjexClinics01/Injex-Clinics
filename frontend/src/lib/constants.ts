export const APP_NAME = "Injex Clinics";
export const APP_TAGLINE = "Goals, leaderboard & rewards for your team";

export const ROLE_LABELS = {
  admin: "Administrator",
  employee: "Employee",
} as const;

/** Entry status as shown to people. A rejected entry is either final or a correction request. */
export function entryStatusLabel(status: "draft" | "pending" | "approved" | "rejected", finalRejection = false) {
  if (status === "rejected") return finalRejection ? "Rejected" : "Needs correction";
  return { draft: "Draft", pending: "Pending review", approved: "Approved" }[status];
}

/** Display labels for the seeded category slugs (DB holds the source of truth). */
const CATEGORY_LABELS: Record<string, string> = {
  nurse: "Nurse",
  beauty_therapist: "Beauty Therapist",
};

export function categoryLabel(slug: string | null | undefined) {
  if (!slug) return "Unassigned";
  return CATEGORY_LABELS[slug] ?? slug.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
