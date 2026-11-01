import Link from "next/link";
import { TONE_PANEL_CLASS } from "@/components/ui/card";
import { FIGURE_INLINE_CLASS, SECTION_TITLE_CLASS } from "@/components/ui/typography";
import { scopedId } from "@/lib/element-id";
import { shopPath } from "@/lib/staff-notices";
import { counterRowId } from "../../_arrivals/focus";
import type { PrepView } from "./prep-view";

/** The tank count, where it comes from, and the nitrox seats that cannot fill yet. */
export function PrepTanks({ view, showNitrox }: { view: PrepView; showNitrox: boolean }) {
  const { prep, t, shopSlug, tripId, idPrefix } = view;
  const { checklist } = prep;
  return (
    <>
      <section aria-labelledby={scopedId(idPrefix, "tanks-heading")}>
        {/* This section heading shares the same visual level as the cards. */}
        <h2 id={scopedId(idPrefix, "tanks-heading")} className={SECTION_TITLE_CLASS}>
          {t("tripPrep.tanksHeading")}
        </h2>
        {/* Explain the per-dive total, including diving crew, beside the count. */}
        <p className="mt-1 text-sm text-muted">
          {[
            t("tripPrep.diverCount", { count: checklist.diverCount }),
            checklist.crewCount > 0
              ? t("tripPrep.crewCount", { count: checklist.crewCount })
              : null,
            t("tripPrep.diveCount", { count: checklist.diveCount }),
            t("tripPrep.oneTankPerDiver"),
          ]
            .filter((line) => line !== null)
            .join(" · ")}
        </p>
        {/* One total with an air/nitrox split when nitrox is present. */}
        <p className={`mt-3 ${FIGURE_INLINE_CLASS}`}>{tanksLine(t, checklist.tanks, showNitrox)}</p>
        {/* Counts approved nitrox seats, not analyzed cylinders. Paper carries
            this note in the printed day's header. */}
        {showNitrox && checklist.tanks.nitrox > 0 && !view.paper ? (
          <p className="mt-1 text-sm text-muted print:hidden">{t("tripPrep.nitroxCountNote")}</p>
        ) : null}
      </section>

      {showNitrox && checklist.nitroxBlockers.length > 0 ? (
        <section
          aria-labelledby={scopedId(idPrefix, "nitrox-blocked-heading")}
          // Match the page's panel geometry; warning border and fill carry tone.
          className={`${TONE_PANEL_CLASS} border-warning/40 bg-warning/10`}
        >
          <h2 id={scopedId(idPrefix, "nitrox-blocked-heading")} className={SECTION_TITLE_CLASS}>
            {t("tripPrep.nitroxBlockedHeading")}
          </h2>
          <p className="mt-1 text-sm">{t("tripPrep.nitroxBlockedDescription")}</p>
          {/* Separate bullets from text so wrapped lines align under words. */}
          <ul className="mt-4 flex flex-col gap-1 text-sm">
            {checklist.nitroxBlockers.map((blocker) => (
              <li key={blocker.bookingId} className="flex gap-1.5">
                <span aria-hidden="true">•</span>
                {blocker.reason === "identity_held" ? (
                  // A held identity may match someone else; link to the seat's
                  // roster row, never the matched person's record.
                  <span>
                    <span className="font-medium">{blocker.fullName}</span>{" "}
                    <Link
                      href={`${shopPath(shopSlug, "trips", tripId)}#${counterRowId(blocker.bookingId)}`}
                      className="text-primary hover:underline"
                    >
                      {t("tripPrep.nitroxConfirmIdentityFirst")}
                    </Link>
                  </span>
                ) : (
                  <span>
                    <Link
                      href={`/shop/${shopSlug}/divers/${blocker.personId}`}
                      className="font-medium hover:text-primary hover:underline"
                    >
                      {blocker.fullName}
                    </Link>
                  </span>
                )}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </>
  );
}

/**
 * Show one total; add the air/nitrox split only when nitrox is offered and used.
 */
export function tanksLine(
  t: PrepView["t"],
  tanks: { total: number; air: number; nitrox: number },
  showNitrox: boolean,
): string {
  return showNitrox && tanks.nitrox > 0
    ? t("gear.prep.tanksLineMixed", { count: tanks.total, air: tanks.air, nitrox: tanks.nitrox })
    : t("gear.prep.tanksLineAir", { count: tanks.total });
}
