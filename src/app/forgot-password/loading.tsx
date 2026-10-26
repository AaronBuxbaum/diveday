import { EntryShellSkeleton } from "@/components/account/EntryShellSkeleton";

export default function ForgotPasswordLoading() {
  return <EntryShellSkeleton wordmark fields={["email"]} />;
}
