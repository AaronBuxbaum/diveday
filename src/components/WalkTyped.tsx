import type { CSSProperties } from "react";

/**
 * Text Priya types into a drawn field. In the homepage walkthrough's first phase the characters
 * arrive left to right (`data-walk-type`, `globals.css`), starting `delay` ms into the beat; in
 * every other phase, and for a reader without the player, it is the finished text.
 */
export function WalkTyped({ text, delay = 0 }: { text: string; delay?: number }) {
  return (
    <span
      data-walk-type=""
      className="inline-block align-bottom"
      style={{ "--type-chars": text.length, "--type-delay": `${delay}ms` } as CSSProperties}
    >
      {text}
    </span>
  );
}

/** A drawn text box: its caption over the box, holding whatever she has typed (or nothing yet). */
export function WalkField({
  label,
  children,
  className,
}: {
  label: string;
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <p className="text-xs font-medium text-muted">{label}</p>
      <div className="mt-1 flex min-h-9 items-center rounded-lg border border-border bg-surface px-3 text-sm">
        {children}
      </div>
    </div>
  );
}
