import "server-only";

import { createClient } from "@/lib/supabase/server";
import type { HallOfFameAward } from "@/types/database";

export async function listHallOfFameAwards(): Promise<HallOfFameAward[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("hall_of_fame_awards")
    .select(`
      *,
      employee:profiles!hall_of_fame_awards_employee_id_fkey(
        id,
        full_name,
        email,
        employee_category
      )
    `)
    .eq("is_active", true)
    .order("created_at", { ascending: false })
    .limit(1);

  if (error) {
    // If the table does not exist yet or has an issue, fail gracefully with empty array
    console.error("Could not load Hall of Fame awards:", error.message);
    return [];
  }

  return (data as unknown as HallOfFameAward[]) ?? [];
}
