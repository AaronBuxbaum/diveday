import { EntryShellSkeleton } from "@/components/account/EntryShellSkeleton";

/**
 * Body-shaped skeleton for a demo story door (design principle 1): the shell's
 * own skeleton, shaped like what `EntryShell` renders above it — wordmark,
 * eyebrow, title, a description of two lines at every width, one button — so
 * arriving from a pasted link paints the door rather than a jump.
 *
 * It was hand-rolled, and it drew a full-width 44px bar where the page lands a
 * 48px button centred in the column (K-576): the shell's single-button bar is
 * that button.
 */
export default function DemoStoryLoading() {
  return (
    <EntryShellSkeleton wordmark eyebrow descriptionLines={2} panel={false} footnote={false} />
  );
}
