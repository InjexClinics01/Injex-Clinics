import { CheckCircle2, CircleAlert, Coins, ShieldCheck, Tags, Trophy } from "lucide-react";
import type { Metadata } from "next";

import { LeaderboardSettingsForm } from "@/components/admin/leaderboard-settings-form";
import { PointsSettingsForm } from "@/components/admin/points-settings-form";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireAdmin } from "@/lib/auth/session";
import { isAdminClientConfigured, secretKeyKind } from "@/lib/supabase/admin";
import { publicKeyKind } from "@/lib/supabase/env";
import { APP_TIME_ZONE } from "@/lib/utils/format";
import { listCategories, listProfiles } from "@/services/employees";
import { getAppSettings } from "@/services/performance";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage() {
  await requireAdmin();
  const [categories, profiles, settings] = await Promise.all([listCategories(), listProfiles(), getAppSettings()]);
  const counts = new Map<string, number>();
  for (const p of profiles) if (p.employee_category) counts.set(p.employee_category, (counts.get(p.employee_category) ?? 0) + 1);

  const pub = publicKeyKind();
  const secret = secretKeyKind();

  const checks = [
    { label: "Supabase connection", ok: true, detail: "Connected (you are signed in)." },
    {
      label: "Public key (NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY)",
      ok: pub === "publishable",
      detail:
        pub === "publishable"
          ? "New publishable key (sb_publishable_…)."
          : "Legacy anon key in use. Switch to the publishable key before Supabase removes legacy keys.",
    },
    {
      label: "Server secret key (SUPABASE_SECRET_KEY)",
      ok: isAdminClientConfigured() && secret === "secret",
      detail: !isAdminClientConfigured()
        ? "Not set. Account creation and sign-in blocking are unavailable."
        : secret === "secret"
          ? "New secret key (sb_secret_…). Admins can create, invite and deactivate accounts."
          : "Legacy service_role key in use. Works for now; switch to a secret key (sb_secret_…).",
    },
    {
      label: "Site URL (NEXT_PUBLIC_SITE_URL)",
      ok: Boolean(process.env.NEXT_PUBLIC_SITE_URL),
      detail: process.env.NEXT_PUBLIC_SITE_URL ?? "Not set. Email links will use the request host.",
    },
    { label: "Business time zone", ok: true, detail: APP_TIME_ZONE },
  ];

  return (
    <>
      <PageHeader title="Settings" description="Organisation configuration and system status." />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Tags className="size-4 text-primary" aria-hidden /> Employee categories
            </CardTitle>
            <CardDescription>Each category has its own daily form, leaderboard and scoring rules.</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="divide-y">
              {categories.map((c) => (
                <li key={c.id} className="flex items-start justify-between gap-4 py-3 first:pt-0 last:pb-0">
                  <div className="min-w-0">
                    <p className="font-medium">{c.name}</p>
                    {c.description && <p className="text-sm text-muted-foreground">{c.description}</p>}
                    <p className="mt-0.5 font-mono text-xs text-muted-foreground">{c.slug}</p>
                  </div>
                  <Badge variant="secondary">{counts.get(c.slug) ?? 0} staff</Badge>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Trophy className="size-4 text-primary" aria-hidden /> Leaderboard
            </CardTitle>
            <CardDescription>Employees always see their own category&apos;s leaderboard.</CardDescription>
          </CardHeader>
          <CardContent>
            <LeaderboardSettingsForm overallEnabled={settings.overall_leaderboard_enabled} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Coins className="size-4 text-primary" aria-hidden /> Points
            </CardTitle>
            <CardDescription>
              Scoring rules are set per metric in Goals &amp; Scoring. Changes here apply to periods credited from now on.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <PointsSettingsForm settings={settings} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ShieldCheck className="size-4 text-primary" aria-hidden /> System status
            </CardTitle>
            <CardDescription>Configuration checks for this deployment.</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="space-y-4">
              {checks.map((c) => (
                <li key={c.label} className="flex gap-3">
                  {c.ok ? (
                    <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" aria-label="OK" />
                  ) : (
                    <CircleAlert className="mt-0.5 size-4 shrink-0 text-warning" aria-label="Needs attention" />
                  )}
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{c.label}</p>
                    <p className="text-sm break-words text-muted-foreground">{c.detail}</p>
                  </div>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
