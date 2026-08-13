import { EntryShellSkeleton } from "@/components/account/EntryShellSkeleton";

/**
 * Entry-shell-shaped skeleton for /unsubscribe (design principle 1) — the
 * token lookup has no partial state to show meanwhile, so the shell is the
 * centered one-question block every branch of this page lands in.
 */
export default function UnsubscribeLoading() {
  return <EntryShellSkeleton wordmark panel={false} footnote={false} />;
}
