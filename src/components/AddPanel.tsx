import Link from "next/link";
import { type ReactNode, Suspense } from "react";
import { AddPanelFocus } from "@/components/AddPanelFocus";
import { DiveDayIcon } from "@/components/StaffDestinationIcon";
import { buttonClass } from "@/components/ui/button";
import { sectionCardClass } from "@/components/ui/card";
import { SECTION_TITLE_CLASS } from "@/components/ui/typography";

/**
 * **The one shell every "add one" panel wears** (issue #2737, `src/lib/add-panel.ts`).
 *
 * An index opens it from its own URL (`?add=`) and draws it at the top of the
 * page, above the list it adds to: full width on a phone, the reading measure
 * on a desk, so a form is never squeezed beside a table. Closed, it renders
 * nothing, and the form passed as `children` never runs: an index pays for a
 * form's reads only while somebody is filling it in. Open, the form streams in
 * behind its own skeleton, so the list below never waits on it.
 *
 * The close control is a link back to the same index without `add`, so
 * closing is a navigation the Back button understands, and it works before
 * the page has hydrated.
 */
export function AddPanel({
  open,
  id = "add",
  title,
  description,
  closeHref,
  closeLabel,
  className = "",
  children,
}: {
  /** Read off the URL by the page (`addPanelOpen`). */
  open: boolean;
  /** The panel's fragment id; one page with two panels names them apart. */
  id?: string;
  title: string;
  /** One quiet line under the title, only where the form needs it said. */
  description?: ReactNode;
  /** The index without the panel (`addPanelCloseHref`). */
  closeHref: string;
  closeLabel: string;
  className?: string;
  /** The form. An async Server Component loads its own reads here. */
  children: ReactNode;
}) {
  if (!open) return null;
  const headingId = `${id}-title`;
  return (
    <section
      id={id}
      aria-labelledby={headingId}
      data-add-panel=""
      className={sectionCardClass({
        padding: "lg",
        className: `mt-6 mb-8 max-w-3xl scroll-mt-24 animate-scale-in ${className}`,
      })}
    >
      <AddPanelFocus panelId={id} closeHref={closeHref} />
      <div className="flex items-start justify-between gap-3">
        <h2
          id={headingId}
          data-add-panel-heading=""
          tabIndex={-1}
          className={`${SECTION_TITLE_CLASS} min-w-0 pt-2 focus:outline-none`}
        >
          {title}
        </h2>
        <Link
          href={closeHref}
          scroll={false}
          aria-label={closeLabel}
          title={closeLabel}
          data-add-panel-close=""
          className={buttonClass({ variant: "ghost", size: "icon", className: "-me-2 shrink-0" })}
        >
          <DiveDayIcon name="close" className="size-4" />
        </Link>
      </div>
      {description ? <p className="mt-1 text-sm text-muted">{description}</p> : null}
      <div className="mt-6">
        <Suspense fallback={<AddPanelFormSkeleton />}>{children}</Suspense>
      </div>
    </section>
  );
}

/** Three field-shaped bars and an action: the panel's form, before its reads land. */
export function AddPanelFormSkeleton() {
  return (
    <div className="animate-pulse space-y-4" aria-hidden="true">
      {["one", "two", "three"].map((slot) => (
        <div key={slot}>
          <div className="h-4 w-24 rounded bg-surface-sunken" />
          <div className="mt-2 h-12 w-full rounded-lg bg-surface-sunken" />
        </div>
      ))}
      <div className="h-12 w-32 rounded-lg bg-surface-sunken" />
    </div>
  );
}
