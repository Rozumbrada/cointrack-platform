"use client";

import { useParams } from "next/navigation";
import ProfileForm from "@/components/app/ProfileForm";

export default function EditProfilePage() {
  const params = useParams<{ syncId: string }>();
  return <ProfileForm mode="edit" syncId={params.syncId} />;
}
