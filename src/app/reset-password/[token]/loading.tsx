import { EntryShellSkeleton } from "@/components/account/EntryShellSkeleton";

/**
 * Entry-shell-shaped skeleton for "set a new password" (design principle 1).
 * The bearer token has to be looked up before this page knows whether it is
 * showing the form or an expired-link outcome, so the shell shows the door
 * both of them land in.
 */
export default function ResetPasswordLoading() {
  return <EntryShellSkeleton wordmark fields={["password", "confirm"]} />;
}
