/**
 * The shared "nothing here yet" card: a dashed-border panel that reads as a
 * placeholder rather than real content. Use it for list/collection empty states
 * so they look uniform across the staff app. Pass the heading and copy as
 * children; `className` adds spacing (e.g. `mt-4`) without changing the look.
 */
export function EmptyState({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`rounded-2xl border border-dashed border-border-strong bg-surface p-10 text-center${
        className ? ` ${className}` : ""
      }`}
    >
      {children}
    </div>
  );
}
