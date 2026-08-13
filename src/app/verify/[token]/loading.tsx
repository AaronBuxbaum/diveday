import { EntryShellSkeleton } from "@/components/account/EntryShellSkeleton";

/**
 * Entry-shell-shaped skeleton for email verification (design principle 1).
 * The page is one question and one button either way, so the shell is the
 * centered block it lands in rather than a spinner.
 */
export default function VerifyLoading() {
  return <EntryShellSkeleton wordmark panel={false} footnote={false} />;
}
