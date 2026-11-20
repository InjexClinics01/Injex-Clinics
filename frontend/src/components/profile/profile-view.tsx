
import { NewPasswordForm } from "@/components/auth/new-password-form";
import { PageHeader } from "@/components/layout/page-header";
import { ProfileForm } from "@/components/profile/profile-form";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { categoryLabel, ROLE_LABELS } from "@/lib/constants";
import { formatDate } from "@/lib/utils/format";
import type { Profile } from "@/types/database";

export function ProfileView({ profile }: { profile: Profile }) {
  const details = [
    { label: "Email", value: profile.email },
    { label: "Role", value: ROLE_LABELS[profile.role] },
    {
      label: "Category",
      value: profile.role === "admin" && !profile.employee_category ? "—" : categoryLabel(profile.employee_category),
    },
    { label: "Member since", value: formatDate(profile.created_at) },
  ];

  return (
    <>
      <PageHeader title="My profile" description="Your account details and security settings." />
      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle>Account</CardTitle>
            <CardDescription>Role and category are managed by your administrator.</CardDescription>
          </CardHeader>
          <CardContent>
            <dl className="space-y-4">
              {details.map((d) => (
                <div key={d.label}>
                  <dt className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{d.label}</dt>
                  <dd className="mt-0.5 text-sm break-words">{d.value}</dd>
                </div>
              ))}
              <div>
                <dt className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Status</dt>
                <dd className="mt-1">
                  <Badge variant="outline" className="border-success/40 text-success">
                    Active
                  </Badge>
                </dd>
              </div>
            </dl>
          </CardContent>
        </Card>

        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>Personal details</CardTitle>
              <CardDescription>This name is shown to administrators and, later, on the leaderboard.</CardDescription>
            </CardHeader>
            <CardContent>
              <ProfileForm fullName={profile.full_name} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Change password</CardTitle>
              <CardDescription>Choose a strong password you don&apos;t use anywhere else.</CardDescription>
            </CardHeader>
            <CardContent>
              <NewPasswordForm mode="change" submitLabel="Change password" />
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
