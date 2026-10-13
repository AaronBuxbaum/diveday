import Link from "next/link";
import { buttonClass } from "@/components/ui/button";
import { staffTranslator } from "@/i18n/staff-messages";

/**
 * The one staff-facing strip on an otherwise entirely diver-facing page.
 *
 * A signed-in staffer viewing their own shop's booking page used to be
 * redirected straight to the management view, which made the trip overview's
 * "View booking page" button impossible to use — it opened the page and the
 * page sent them back. This says the same thing the redirect was trying to say
 * ("this is the diver's view, the management view is over here") while leaving
 * the preview on screen.
 *
 * Staff words come from the staff bundle even here — the rest of this page
 * speaks to divers, and mixing the two vocabularies in one file is exactly what
 * the two bundles exist to prevent. A server component, so the staff bundle is
 * resolved here and never reaches the browser.
 */
export function StaffPreviewBar({
  locale,
  shopSlug,
  tripId,
}: {
  locale: string;
  shopSlug: string;
  tripId: string;
}) {
  const t = staffTranslator(locale);
  const message = t("trips.publicPreview.banner");
  const manageLabel = t("trips.publicPreview.manage");
  const manageHref = `/shop/${shopSlug}/trips/${tripId}`;
  return (
    <div
      role="status"
      className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-inset border border-border bg-surface-sunken px-4 py-3"
    >
      <p className="text-sm font-medium">{message}</p>
      <Link href={manageHref} className={buttonClass({ variant: "secondary", size: "sm" })}>
        {manageLabel}
      </Link>
    </div>
  );
}
