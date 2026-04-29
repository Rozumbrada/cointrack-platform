import AccountForm from "@/components/app/AccountForm";

export default async function EditAccountPage({
  params,
}: {
  params: Promise<{ syncId: string }>;
}) {
  const { syncId } = await params;
  return <AccountForm mode="edit" syncId={syncId} />;
}
