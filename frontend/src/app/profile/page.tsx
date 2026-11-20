import type { Metadata } from "next";

import { ProfileView } from "@/components/profile/profile-view";
import { requireUser } from "@/lib/auth/session";

export const metadata: Metadata = { title: "My profile" };

export default async function ProfilePage() {
  const profile = await requireUser();
  return <ProfileView profile={profile} />;
}
