/**
 * The shared "nothing here yet" card: a dashed-border panel that reads as a
 * placeholder rather than real content. Use it for list/collection empty states
 * so they look uniform across the staff app. Pass the heading and copy as
 * children; `className` adds spacing (e.g. `mt-4`) without changing the look.
 * A small decorative icon sits above the children by default — pass
 * `icon={false}` to omit it for tighter/nested empty states.
 */
export function EmptyState({
  children,
  className,
  icon = true,
}: {
  children: React.ReactNode;
  className?: string;
  icon?: boolean;
}) {
  return (
    <div
      className={`rounded-2xl border border-dashed border-border-strong bg-surface p-10 text-center${
        className ? ` ${className}` : ""
      }`}
    >
      {icon ? <EmptyStateIcon /> : null}
      {children}
    </div>
  );
}

/**
 * Three rising bubbles, decorative only — the heading/copy next to it already
 * carries the meaning. Drawn with `currentColor` so it follows theme; kept
 * muted and static since empty states are rest states, not earned moments.
 */
function EmptyStateIcon() {
  return (
    <svg
      viewBox="0 0 40 40"
      width="40"
      height="40"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden="true"
      className="mx-auto mb-3 text-muted"
    >
      <circle cx="20" cy="24" r="5" />
      <circle cx="14" cy="12" r="3" />
      <circle cx="26" cy="15" r="2" />
    </svg>
  );
}
