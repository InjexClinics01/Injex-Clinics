import { z } from "zod";

/** Validation for admin review decisions (browser + server). */

export const REVIEW_NOTE_MAX = 500;

export const REVIEW_DECISIONS = ["approve", "correction", "reject"] as const;
export type ReviewDecision = (typeof REVIEW_DECISIONS)[number];

export const reviewSchema = z
  .object({
    entry_id: z.uuid({ error: "Unknown submission" }),
    decision: z.enum(REVIEW_DECISIONS, { error: "Choose a decision" }),
    note: z
      .string()
      .trim()
      .max(REVIEW_NOTE_MAX, `Keep the note to ${REVIEW_NOTE_MAX} characters or fewer`)
      .refine((v) => !/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(v), "Note contains invalid characters"),
  })
  .refine((v) => v.decision === "approve" || v.note.length >= 3, {
    path: ["note"],
    message: "Give a reason (at least 3 characters) so the employee knows what to change",
  });

export function readReview(fd: FormData) {
  const str = (key: string) => {
    const v = fd.get(key);
    return typeof v === "string" ? v : "";
  };
  return { entry_id: str("entry_id"), decision: str("decision"), note: str("note") };
}
