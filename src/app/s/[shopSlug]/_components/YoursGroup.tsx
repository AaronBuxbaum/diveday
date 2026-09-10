import Link from "next/link";
import { openMyShelfAction } from "@/app/actions/shelf-door";
import { DiveDayIcon } from "@/components/StaffDestinationIcon";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { SECTION_TITLE_CLASS } from "@/components/ui/typography";

export type YoursRow = {
  /** A stable key, and the trip this row is about. */
  id: string;
  href: string;
  title: string;
  /** The day and time, already worded in the shop's zone. */
  when: string;
  /** Why this row is here ("Same boat, next Saturday"), or null for the booked seat. */
  because: string | null;
};

/**
 * **"Yours" — the group a returning diver's storefront opens with.**
 *
 * Above the week, because a diver whose phone knows them is not browsing a
 * board: they are checking one of two things, when they are next out and
 * whether the boat they liked runs again. The week is still under it, unchanged
 * and complete, so nothing is hidden by being greeted.
 *
 * Rows only. No price, no seat count, no state pill: each row links to the
 * departure, which states all three, and this group's job is to be the shortest
 * distance to it. Without the cookie nothing here renders at all and the
 * storefront is the page an anonymous visitor sees.
 *
 * The shelf's own door is a **form**, not a link: the token lives in an
 * `HttpOnly` cookie and an `href` would print it into the public page's HTML
 * (`openMyShelfAction`).
 */
export function YoursGroup({
  heading,
  greeting,
  rows,
  shopSlug,
  shelfLabel,
}: {
  heading: string;
  /** The one sentence: their name, and which visit the next one is. */
  greeting: string;
  rows: readonly YoursRow[];
  shopSlug: string;
  shelfLabel: string;
}) {
  return (
    <section
      aria-label={heading}
      className="mt-8 rounded-lg border border-border bg-surface p-4 sm:p-6"
    >
      <p className="text-lg font-medium">{greeting}</p>
      <h2 className={`mt-4 ${SECTION_TITLE_CLASS}`}>{heading}</h2>
      <ul className="mt-2 divide-y divide-border">
        {rows.map((row) => (
          <li key={row.id}>
            <Link
              href={row.href}
              className="group flex min-h-11 items-center gap-3 py-3 transition-colors hover:text-primary"
            >
              <span className="min-w-0 flex-1">
                <span className="block text-base font-semibold">{row.title}</span>
                <span className="block text-sm text-muted">
                  {row.because ? `${row.because} · ${row.when}` : row.when}
                </span>
              </span>
              <DiveDayIcon
                name="chevron-right"
                className="size-4 shrink-0 text-muted transition-transform group-hover:translate-x-0.5"
              />
            </Link>
          </li>
        ))}
        <li className="py-3">
          <form action={openMyShelfAction.bind(null, shopSlug)}>
            <SubmitButton pendingLabel={shelfLabel} className={buttonClass({ variant: "link" })}>
              {shelfLabel}
            </SubmitButton>
          </form>
        </li>
      </ul>
    </section>
  );
}
