import { z } from "zod";

export const hallOfFameSchema = z.object({
  employee_id: z.string().uuid("Select an employee."),
  title: z
    .string()
    .trim()
    .min(2, "Title must be at least 2 characters.")
    .max(100, "Title cannot exceed 100 characters.")
    .refine((v) => !/[\x00-\x1F\x7F]/.test(v), "Title contains invalid characters."),
  award_period: z
    .string()
    .trim()
    .min(2, "Period must be at least 2 characters (e.g. 'May 2026' or 'All-Time').")
    .max(50, "Period cannot exceed 50 characters."),
  citation: z
    .string()
    .trim()
    .min(5, "Reason/citation must be at least 5 characters.")
    .max(500, "Reason/citation cannot exceed 500 characters.")
    .refine((v) => !/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/.test(v), "Reason contains invalid characters."),
  bonus_points: z
    .string()
    .trim()
    .transform((v) => (v === "" ? 0 : Number(v)))
    .pipe(
      z
        .number()
        .int("Must be a whole number.")
        .min(0, "Bonus points cannot be negative.")
        .max(100000, "Bonus points cannot exceed 100,000."),
    ),
});

export type HallOfFameInput = z.infer<typeof hallOfFameSchema>;

const str = (fd: FormData, key: string) => {
  const v = fd.get(key);
  return typeof v === "string" ? v : "";
};

export function readHallOfFame(fd: FormData) {
  return {
    employee_id: str(fd, "employee_id"),
    title: str(fd, "title"),
    award_period: str(fd, "award_period"),
    citation: str(fd, "citation"),
    bonus_points: str(fd, "bonus_points"),
  };
}
