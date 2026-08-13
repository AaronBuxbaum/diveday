import { EntryShellSkeleton } from "@/components/account/EntryShellSkeleton";

/**
 * Entry-shell-shaped skeleton for a staff invitation (design principle 1) —
 * the token lookup that decides between the accept form and an expired-link
 * outcome runs per request, so the shell shows the door both outcomes render
 * into.
 */
export default function InviteLoading() {
  return <EntryShellSkeleton wordmark fields={["password", "confirm"]} />;
}
