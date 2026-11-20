"use client";

import { Award, Crown, Pencil, Sparkles, Trash2, Trophy } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { deleteHallOfFameAward } from "@/app/admin/leaderboard/actions";
import { HallOfFameDialog } from "@/components/admin/hall-of-fame-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { categoryLabel } from "@/lib/constants";
import { formatDate } from "@/lib/utils/format";
import type { HallOfFameAward, Profile } from "@/types/database";

type Props = {
  awards: HallOfFameAward[];
  isAdmin: boolean;
  employees?: Pick<Profile, "id" | "full_name" | "employee_category">[];
  suggestedEmployeeId?: string | null;
  suggestedPeriod?: string;
};

export function HallOfFameCard({
  awards,
  isAdmin,
  employees = [],
  suggestedEmployeeId,
  suggestedPeriod,
}: Props) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [isEditMode, setIsEditMode] = useState(false);
  const [isDeleting, startDeleteTransition] = useTransition();

  // Exactly one active Hall of Fame award (Option A)
  const award = awards[0];

  const handleOpenCreate = () => {
    setIsEditMode(false);
    setDialogOpen(true);
  };

  const handleOpenEdit = () => {
    setIsEditMode(true);
    setDialogOpen(true);
  };

  const handleDelete = (awardId: string, name: string) => {
    if (!window.confirm(`Are you sure you want to remove the Hall of Fame award for ${name}?`)) {
      return;
    }

    startDeleteTransition(async () => {
      const res = await deleteHallOfFameAward(awardId);
      if (res.status === "success") {
        toast.success(res.message);
      } else {
        toast.error(res.message);
      }
    });
  };

  return (
    <>
      <Card className="relative overflow-hidden border-amber-500/30 bg-gradient-to-br from-amber-50/50 via-background to-amber-100/20 dark:from-amber-950/20 dark:via-background dark:to-amber-900/10">
        <CardHeader className="flex flex-row items-start justify-between gap-4 pb-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-lg font-bold text-amber-700 dark:text-amber-400">
              <Trophy className="size-5 text-amber-500" aria-hidden />
              Hall of Fame &amp; Recognition
            </CardTitle>
            <CardDescription>
              Celebrating exceptional staff achievements, dedication, and clinical excellence.
            </CardDescription>
          </div>
          {isAdmin && (
            <Button
              size="sm"
              variant="outline"
              onClick={handleOpenCreate}
              className="border-amber-500/40 text-amber-700 hover:bg-amber-100/50 hover:text-amber-800 dark:text-amber-300 dark:hover:bg-amber-900/30"
            >
              <Award className="size-4" aria-hidden />
              {award ? "Change Inductee" : "Induct Staff"}
            </Button>
          )}
        </CardHeader>

        <CardContent>
          {!award ? (
            <div className="flex flex-col items-center justify-center py-6 text-center text-sm text-muted-foreground">
              <Award className="size-8 text-muted-foreground/40 mb-2" aria-hidden />
              <p className="font-medium text-foreground">No Hall of Fame inductee yet</p>
              <p className="text-xs">
                {isAdmin
                  ? "Click 'Induct Staff' to recognise your current Employee of the Month!"
                  : "Check back soon as top achievements are announced."}
              </p>
            </div>
          ) : (
            <div className="relative rounded-xl border border-amber-500/40 bg-card p-4 sm:p-5 shadow-xs">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-start gap-3.5">
                  <div className="flex size-12 shrink-0 items-center justify-center rounded-full bg-amber-500/10 text-amber-600 dark:bg-amber-500/20 dark:text-amber-400">
                    <Crown className="size-6" aria-hidden />
                  </div>
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-base font-bold sm:text-lg">
                        {award.employee?.full_name ?? "Employee"}
                      </span>
                      {award.employee?.employee_category && (
                        <Badge variant="secondary" className="text-xs">
                          {categoryLabel(award.employee.employee_category)}
                        </Badge>
                      )}
                      <Badge variant="outline" className="border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400">
                        {award.award_period}
                      </Badge>
                    </div>
                    <p className="text-sm font-semibold text-amber-600 dark:text-amber-400">
                      {award.title}
                    </p>
                    <blockquote className="mt-2 text-sm italic text-muted-foreground">
                      &ldquo;{award.citation}&rdquo;
                    </blockquote>
                  </div>
                </div>

                <div className="flex flex-row items-center justify-between gap-3 sm:flex-col sm:items-end sm:justify-center">
                  {award.bonus_points > 0 && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2.5 py-1 text-xs font-semibold text-primary">
                      <Sparkles className="size-3" aria-hidden />
                      +{award.bonus_points} pts
                    </span>
                  )}
                  <span className="text-xs text-muted-foreground">
                    Awarded {formatDate(award.created_at)}
                  </span>
                  {isAdmin && (
                    <div className="flex items-center gap-1 pt-1">
                      <Button
                        size="xs"
                        variant="ghost"
                        onClick={handleOpenEdit}
                        className="text-amber-700 hover:bg-amber-100/50 hover:text-amber-800 dark:text-amber-300 dark:hover:bg-amber-900/30"
                      >
                        <Pencil className="size-3.5" aria-hidden />
                        Edit
                      </Button>
                      <Button
                        size="xs"
                        variant="ghost"
                        disabled={isDeleting}
                        onClick={() =>
                          handleDelete(
                            award.id,
                            award.employee?.full_name ?? "this employee",
                          )
                        }
                        className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                      >
                        <Trash2 className="size-3.5" aria-hidden />
                        Remove
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {isAdmin && (
        <HallOfFameDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          employees={employees}
          suggestedEmployeeId={suggestedEmployeeId}
          suggestedPeriod={suggestedPeriod}
          initialData={isEditMode ? award : null}
        />
      )}
    </>
  );
}
