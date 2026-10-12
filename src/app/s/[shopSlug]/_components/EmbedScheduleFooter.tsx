import Link from "next/link";
import { EmbedCredit } from "@/components/EmbedCredit";
import { buttonClass } from "@/components/ui/button";
import type { DiverTranslator } from "@/i18n/messages";
import { publicSchedulePath } from "@/lib/public-routes";

/**
 * The schedule widget's foot, rendered only inside the frame (`?embed=1`).
 *
 * Human-discovery footer, embed mode only — a single small line, not a
 * banner, so the widget stays compact and booking-focused (docs ADR
 * 20260726-schedule-embed). A relative href resolves against the
 * iframe's own document (this page's origin), not the parent page, so
 * it reaches the DiveDay homepage regardless of what site framed it.
 */
export function EmbedScheduleFooter({
  shopSlug,
  zoneNote,
  hostCarriesCredit,
  t,
}: {
  shopSlug: string;
  /** "Times are in …" for the widget, anchored on a real departure; null when there is none. */
  zoneNote: string | null;
  /** The loader drew the credit on the host page (`credit=host`), so the frame draws none. */
  hostCarriesCredit: boolean;
  t: DiverTranslator;
}) {
  return (
    <>
      <div className="mt-8 flex flex-col items-center gap-2 border-t border-border pt-6">
        {/* **The way out of the frame.** The widget shows the next few
            departures; everything else is one tap away on a real page, which
            is a better answer than a scrollbar inside somebody else's site.
            `target="_blank"` for the same reason the DiveDay link below has
            it — a schedule opened *inside* a 900px frame is the nested scroll
            this change exists to remove (issue #805). */}
        <Link
          href={publicSchedulePath(shopSlug)}
          target="_blank"
          rel="noopener"
          className={buttonClass({ variant: "secondary", size: "sm" })}
        >
          {t("schedule.embedSeeFullSchedule")}
        </Link>
        {zoneNote ? <p className="text-xs text-muted">{zoneNote}</p> : null}
      </div>
      {hostCarriesCredit ? null : (
        <EmbedCredit
          href={`/?${new URLSearchParams({
            utm_source: "embed",
            utm_medium: "widget",
            utm_campaign: shopSlug,
          }).toString()}`}
          target="_blank"
          rel="noopener"
        >
          {t("schedule.poweredByDiveDay")}
        </EmbedCredit>
      )}
    </>
  );
}
