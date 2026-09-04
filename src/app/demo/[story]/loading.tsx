import { entryMainClass } from "@/components/account/EntryShell";

/**
 * Body-shaped skeleton for a demo story door (design principle 1). Shaped like
 * what `EntryShell` renders above it — wordmark, eyebrow, title, one line, one
 * button — so arriving from a pasted link paints the door rather than a jump.
 */
export default function DemoStoryLoading() {
  return (
    <main className={entryMainClass("sm")}>
      <div className="animate-pulse">
        <div className="mx-auto mb-8 h-7 w-32 rounded bg-surface-sunken" />
        <div className="mx-auto mb-2 h-4 w-24 rounded bg-surface-sunken" />
        <div className="mx-auto h-9 w-64 max-w-full rounded bg-surface-sunken" />
        <div className="mx-auto mt-3 h-10 w-full max-w-prose rounded bg-surface-sunken" />
        <div className="mt-8 h-11 w-full rounded-lg bg-surface-sunken" />
      </div>
    </main>
  );
}
