import Link from "next/link";
import { EmbedCredit } from "@/components/EmbedCredit";
import { buttonClass } from "@/components/ui/button";
import type { DiverTranslator } from "@/i18n/messages";
import { publicSchedulePath } from "@/lib/public-routes";

/**
 * The embedded schedule's foot (docs ADR 20260726-schedule-embed): the door
 * out of the frame, the time-zone line, and the human-discovery credit — a
 * single small line, not a banner, so the widget stays compact and
 * booking-focused. Nothing renders outside the embed.
 *
 * `target="_blank"` on both links: a schedule opened *inside* a 900px frame is
 * the nested scroll the full-schedule door exists to remove (issue #805), and
 * the credit's relative href resolves against the iframe's own document (this
 * page's origin), not the parent page, so it reaches the DiveDay homepage
 * regardless of what site framed it.
 */
export function EmbedFooter({
  isEmbed,
  hostCarriesCredit,
  shopSlug,
  zoneNote,
  t,
}: {
  isEmbed: boolean;
  /** The host page already names DiveDay; saying it twice is noise. */
  hostCarriesCredit: boolean;
  shopSlug: string;
  zoneNote: string | null;
  t: DiverTranslator;
}) {
  if (!isEmbed) return null;
  return (
    <>
      <div className="mt-8 flex flex-col items-center gap-2 border-t border-border pt-6">
        {/* **The way out of the frame.** The widget shows the next few
            departures; everything else is one tap away on a real page, which
            is a better answer than a scrollbar inside somebody else's site. */}
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
          {t("shopChrome.credit")}
        </EmbedCredit>
      )}
    </>
  );
}
