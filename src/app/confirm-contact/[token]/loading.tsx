import { EntryShellSkeleton } from "@/components/account/EntryShellSkeleton";

/**
 * Entry-shell-shaped skeleton for the contact-confirmation page (design
 * principle 1): one question and one button either way, so the shell is the
 * centered block it lands in rather than a spinner.
 */
export default function ConfirmContactLoading() {
  return <EntryShellSkeleton wordmark panel={false} footnote={false} />;
}
