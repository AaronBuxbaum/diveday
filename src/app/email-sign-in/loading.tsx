import { EntryShell } from "@/components/account/EntryShell";

export default function ForgotPasswordLoading() {
  return <EntryShell pending wordmark fields={["email"]} />;
}
