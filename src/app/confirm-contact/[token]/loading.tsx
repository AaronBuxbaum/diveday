import { EntryShellSkeleton } from "@/components/account/EntryShellSkeleton";

/**
 * The same centered block the page lands in either way — one question and one
 * button, or one answer. Shaped like its body rather than a spinner (design
 * principle 1).
 */
export default function ConfirmContactLoading() {
  return <EntryShellSkeleton wordmark panel={false} footnote={false} />;
}
