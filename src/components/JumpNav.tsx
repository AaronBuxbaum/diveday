import { buttonClass } from "@/components/ui/button";

/**
 * Same-document jump links for long pages. Native `#id` anchors work before
 * hydration and do not create route transitions. Destinations have no active
 * state because each remains on the page already in view. Callers resolve
 * labels before rendering so localized copy stays on the server.
 */
export function JumpNav({
  ariaLabel,
  items,
  className = "",
}: {
  ariaLabel: string;
  /** Destinations in page order: the `#id` to jump to and its resolved label. */
  items: readonly { id: string; label: string }[];
  /** Top margin only — the row owns its own rule, padding, and bottom spacing. */
  className?: string;
}) {
  return (
    // Align the first label with the page title. Keep 44px targets and inset
    // focus rings inside the row; jump links have no use in print.
    <div className={`mb-8 border-b border-border pb-2 print:hidden ${className}`}>
      <nav aria-label={ariaLabel} className="-ml-3 flex flex-wrap items-center gap-x-1">
        {items.map((item) => (
          <a
            key={item.id}
            href={`#${item.id}`}
            className={buttonClass({
              variant: "link",
              size: "sm",
              className: "focus-visible:focus-ring-inset",
            })}
          >
            {item.label}
          </a>
        ))}
      </nav>
    </div>
  );
}
