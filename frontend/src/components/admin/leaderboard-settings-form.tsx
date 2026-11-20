"use client";

import { useActionState } from "react";

import { saveLeaderboardSettings } from "@/app/admin/settings/actions";
import { FormMessage } from "@/components/forms/form-field";
import { SubmitButton } from "@/components/forms/submit-button";
import { useConfirmSubmit } from "@/components/forms/use-confirm-submit";
import { leaderboardConfirmation } from "@/lib/admin/confirmations";
import { initialFormState } from "@/lib/auth/validation";

export function LeaderboardSettingsForm({ overallEnabled }: { overallEnabled: boolean }) {
  const [state, action, pending] = useActionState(saveLeaderboardSettings, initialFormState);
  const confirm = useConfirmSubmit((fd) => leaderboardConfirmation(overallEnabled, fd));
  return (
    <form action={action} onSubmit={confirm.wrap()} className="space-y-4">
      <FormMessage status={state.status} message={state.message} />
      <label className="flex cursor-pointer items-start gap-3 rounded-lg border p-3 text-sm">
        <input
          type="checkbox"
          name="overall_leaderboard_enabled"
          defaultChecked={overallEnabled}
          className="mt-0.5 size-4 shrink-0 accent-primary"
        />
        <span>
          <span className="font-medium">Show the overall leaderboard to employees</span>
          <span className="block text-muted-foreground">
            Ranks everyone across categories by normalised points (points earned as a % of the points available in their
            category). Employees still see only their own figures. Admins can always see it.
          </span>
        </span>
      </label>
      <SubmitButton pending={pending} pendingLabel="Saving…" variant="outline">
        Save
      </SubmitButton>
      {confirm.dialog}
    </form>
  );
}
