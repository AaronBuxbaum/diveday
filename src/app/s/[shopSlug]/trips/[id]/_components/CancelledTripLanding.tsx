import Link from "next/link";
import type { ReactNode } from "react";
import { DiveDayIcon } from "@/components/StaffDestinationIcon";
import { DiverIntlProvider } from "@/i18n/DiverIntlProvider";
import type { DiverTranslator } from "@/i18n/messages";
import { publicSchedulePath } from "@/lib/public-routes";
import { CancelledTripNotice } from "./BookingSections";

/**
 * **A cancelled departure's soft landing** (task 13), rather than the same bare
 * `notFound()` as a typo'd URL: a diver who followed a saved or shared link
 * into a since-cancelled departure is told what happened and given a way back.
 * The page decides the departure is cancelled; this renders the answer.
 */
export function CancelledTripLanding({
  locale,
  timeZone,
  isEmbed,
  shopSlug,
  contactEmail,
  staffPreviewBar,
  t,
}: {
  locale: string;
  timeZone: string;
  isEmbed: boolean;
  shopSlug: string;
  contactEmail: string | null;
  staffPreviewBar: ReactNode;
  t: DiverTranslator;
}) {
  return (
    <DiverIntlProvider locale={locale} timeZone={timeZone} namespaces={["booking"]}>
      <main
        className={
          isEmbed
            ? "w-full flex-1 px-3 py-4"
            : "mx-auto w-full max-w-xl flex-1 px-4 py-8 sm:px-6 sm:py-10"
        }
      >
        {staffPreviewBar}
        {/* The way back and the notice, a section apart: the page's
            `space-y-10`, never a margin on the notice (pixel-craft class
            4, K-162). */}
        <div className="space-y-10">
          {isEmbed ? null : (
            <Link
              href={publicSchedulePath(shopSlug)}
              className="inline-flex min-h-11 items-center gap-1 text-sm font-medium text-primary hover:underline"
            >
              <DiveDayIcon name="arrow-left" className="size-4" />
              {t("trip.backToAllTrips")}
            </Link>
          )}
          <CancelledTripNotice shopSlug={shopSlug} embed={isEmbed} contactEmail={contactEmail} />
        </div>
      </main>
    </DiverIntlProvider>
  );
}
