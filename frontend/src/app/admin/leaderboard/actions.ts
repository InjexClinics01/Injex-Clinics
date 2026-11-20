"use server";

import { revalidatePath } from "next/cache";

import { requireAdmin } from "@/lib/auth/session";
import { toFieldErrors, type FormState } from "@/lib/auth/validation";
import { hallOfFameSchema, readHallOfFame } from "@/lib/hall-of-fame/schemas";
import { createClient } from "@/lib/supabase/server";

function revalidate() {
  revalidatePath("/admin/leaderboard");
  revalidatePath("/employee/leaderboard");
  revalidatePath("/admin/points");
}

export async function createHallOfFameAward(_prev: FormState, formData: FormData): Promise<FormState> {
  const admin = await requireAdmin();
  const raw = readHallOfFame(formData);
  const parsed = hallOfFameSchema.safeParse(raw);

  if (!parsed.success) {
    return {
      status: "error",
      message: "Please check the highlighted fields.",
      fieldErrors: toFieldErrors(parsed.error),
      values: raw,
    };
  }

  const input = parsed.data;
  const supabase = await createClient();

  // 1. Verify target employee exists and is active
  const { data: employee, error: empError } = await supabase
    .from("profiles")
    .select("id, full_name, role, is_active")
    .eq("id", input.employee_id)
    .maybeSingle();

  if (empError || !employee) {
    return { status: "error", message: "Selected employee not found.", values: raw };
  }

  // 2. Deactivate any previous awards (Option A: exactly 1 active Hall of Fame award at any time)
  await supabase
    .from("hall_of_fame_awards")
    .update({ is_active: false })
    .eq("is_active", true);

  // 3. Insert new Hall of Fame award
  const { data: award, error: insertError } = await supabase
    .from("hall_of_fame_awards")
    .insert({
      employee_id: input.employee_id,
      awarded_by: admin.id,
      title: input.title,
      award_period: input.award_period,
      citation: input.citation,
      bonus_points: input.bonus_points,
      is_active: true,
    })
    .select("id")
    .single();

  if (insertError || !award) {
    return {
      status: "error",
      message: `Could not save award: ${insertError?.message ?? "Database error"}`,
      values: raw,
    };
  }

  // 3. If bonus points were specified (> 0), award them via adjust_points RPC
  let bonusMessage = "";
  if (input.bonus_points > 0) {
    const { error: pointsError } = await supabase.rpc("adjust_points", {
      p_employee: input.employee_id,
      p_amount: input.bonus_points,
      p_reason: `Hall of Fame Award: ${input.title} (${input.award_period})`,
    });

    if (pointsError) {
      console.error("Failed to credit bonus points:", pointsError.message);
      bonusMessage = " (Note: Could not credit bonus points automatically; please adjust manually on the Points page).";
    } else {
      bonusMessage = ` and credited ${input.bonus_points} bonus points`;
    }
  }

  // 4. Record audit log
  await supabase.from("audit_logs").insert({
    user_id: admin.id,
    action: "hall_of_fame.awarded",
    entity_type: "hall_of_fame_award",
    entity_id: award.id,
    details: {
      employee_id: input.employee_id,
      employee_name: employee.full_name,
      title: input.title,
      award_period: input.award_period,
      bonus_points: input.bonus_points,
    },
  });

  revalidate();
  return {
    status: "success",
    message: `Inducted ${employee.full_name} into the Hall of Fame${bonusMessage}!`,
  };
}

export async function updateHallOfFameAward(
  awardId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const admin = await requireAdmin();
  const raw = readHallOfFame(formData);
  const parsed = hallOfFameSchema.safeParse(raw);

  if (!parsed.success) {
    return { status: "error", fieldErrors: toFieldErrors(parsed.error), values: raw };
  }

  const input = parsed.data;
  const supabase = await createClient();

  // 1. Verify target employee exists and is active
  const { data: employee, error: empError } = await supabase
    .from("profiles")
    .select("id, full_name, role, is_active")
    .eq("id", input.employee_id)
    .maybeSingle();

  if (empError || !employee) {
    return { status: "error", message: "Selected employee not found.", values: raw };
  }

  // 2. Fetch existing award
  const { data: existingAward, error: existError } = await supabase
    .from("hall_of_fame_awards")
    .select("id, bonus_points")
    .eq("id", awardId)
    .maybeSingle();

  if (existError || !existingAward) {
    return { status: "error", message: "Hall of Fame award not found.", values: raw };
  }

  // 3. Update the award
  const { error: updateError } = await supabase
    .from("hall_of_fame_awards")
    .update({
      employee_id: input.employee_id,
      title: input.title,
      award_period: input.award_period,
      citation: input.citation,
      bonus_points: input.bonus_points,
      is_active: true,
    })
    .eq("id", awardId);

  if (updateError) {
    return {
      status: "error",
      message: `Could not update award: ${updateError.message}`,
      values: raw,
    };
  }

  // 4. If new bonus points were increased, credit the difference
  let bonusMessage = "";
  if (input.bonus_points > existingAward.bonus_points) {
    const diff = input.bonus_points - existingAward.bonus_points;
    const { error: pointsError } = await supabase.rpc("adjust_points", {
      p_employee: input.employee_id,
      p_amount: diff,
      p_reason: `Hall of Fame Bonus Adjustment: ${input.title} (${input.award_period})`,
    });
    if (!pointsError) {
      bonusMessage = ` and credited ${diff} additional bonus points`;
    }
  }

  // 5. Audit log
  await supabase.from("audit_logs").insert({
    user_id: admin.id,
    action: "hall_of_fame.updated",
    entity_type: "hall_of_fame_award",
    entity_id: awardId,
    details: {
      employee_id: input.employee_id,
      employee_name: employee.full_name,
      title: input.title,
      award_period: input.award_period,
      bonus_points: input.bonus_points,
    },
  });

  revalidate();
  return {
    status: "success",
    message: `Updated Hall of Fame award for ${employee.full_name}${bonusMessage}!`,
  };
}

export async function deleteHallOfFameAward(awardId: string): Promise<FormState> {
  const admin = await requireAdmin();
  const supabase = await createClient();

  const { error } = await supabase.from("hall_of_fame_awards").delete().eq("id", awardId);

  if (error) {
    return { status: "error", message: `Could not delete award: ${error.message}` };
  }

  await supabase.from("audit_logs").insert({
    user_id: admin.id,
    action: "hall_of_fame.deleted",
    entity_type: "hall_of_fame_award",
    entity_id: awardId,
    details: { deleted_by: admin.id },
  });

  revalidate();
  return { status: "success", message: "Hall of Fame entry removed." };
}
