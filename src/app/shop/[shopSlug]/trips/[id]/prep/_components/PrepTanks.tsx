import Link from "next/link";
import { ShopStat } from "@/components/ShopPageHeader";
import { TONE_PANEL_CLASS } from "@/components/ui/card";
import { SECTION_TITLE_CLASS } from "@/components/ui/typography";
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
        {/* Above its tiles, not a card's title: the body is plural
                    (forms-and-controls.md, "Where a heading goes"), as are the
                    pickups', the kit's and the assignments' below. At a card
                    title's size all the same, so every section here speaks at
                    one volume — these four were 18px beside the cards' 24px. */}
        <h2 id={scopedId(idPrefix, "tanks-heading")} className={SECTION_TITLE_CLASS}>
          {t("tripPrep.tanksHeading")}
        </h2>
        {/* **Where the total comes from, beside the total.** This line
                    used to live in `/prep`'s page header, and the departure
                    page has no such header — so a captain read "Total 22" over
                    a roster of nine with nothing on screen saying the number
                    is *per dive* and that the **diving crew's own tanks are in
                    it** (`buildDivePrepChecklist`: `(divers + divingCrew) ×
                    dives`). Those are the two facts a crew argues about, and
                    adding a divemaster silently moves the total by the dive
                    count. Drawn here so both callers carry it (dive-domain
                    review 20260920). */}
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
        {/* **Three tiles on a screen; one line on paper.** The tiles are
                the right shape for a wall-mounted screen a staffer reads
                across the room, and the wrong one for a sheet carried to the
                boat: three cards of whitespace holding two digits each pushed
                the packing list that follows them onto its own page. Same
                three numbers, said inline. */}
        <div
          className={`mt-3 grid gap-3 print:hidden ${showNitrox ? "grid-cols-3" : "grid-cols-1"}`}
        >
          {showNitrox ? (
            <>
              <ShopStat label={t("tripPrep.total")} value={checklist.tanks.total} />
              <ShopStat label={t("tripPrep.air")} value={checklist.tanks.air} />
              <ShopStat label={t("tripPrep.nitrox")} value={checklist.tanks.nitrox} />
            </>
          ) : (
            // Air and total are the same number with no nitrox split to draw,
            // so there's nothing for a second tile to distinguish.
            <ShopStat label={t("tripPrep.total")} value={checklist.tanks.total} />
          )}
        </div>
        <p className="mt-2 hidden text-base font-semibold tabular-nums print:block">
          {(showNitrox
            ? [
                `${t("tripPrep.total")} ${checklist.tanks.total}`,
                `${t("tripPrep.air")} ${checklist.tanks.air}`,
                `${t("tripPrep.nitrox")} ${checklist.tanks.nitrox}`,
              ]
            : [`${t("tripPrep.total")} ${checklist.tanks.total}`]
          ).join(" · ")}
        </p>
        <p className="mt-2 text-sm text-muted">{t("tripPrep.noGasAnalysisNote")}</p>
      </section>

      {showNitrox && checklist.nitroxBlockers.length > 0 ? (
        <section
          aria-labelledby={scopedId(idPrefix, "nitrox-blocked-heading")}
          // Warning tone, canonical geometry: this and its two neighbours
          // below are the same card as everything else on the page — the
          // panel radius, the bed shadow, `SectionCard`'s own padding and
          // its heading rung — and only the border and fill say which of
          // them is a problem. `SectionCard` has no tone prop on purpose
          // (see its docblock), so a tone-carrying panel spells the chrome
          // here on the card's own geometry (`TONE_PANEL_CLASS`).
          className={`${TONE_PANEL_CLASS} border-warning/40 bg-warning/10`}
        >
          <h2 id={scopedId(idPrefix, "nitrox-blocked-heading")} className={SECTION_TITLE_CLASS}>
            {t("tripPrep.nitroxBlockedHeading")}
          </h2>
          <p className="mt-1 text-sm">{t("tripPrep.nitroxBlockedDescription")}</p>
          {/* A bullet is its own box and the words another, here and
                      in the two lists below, so a wrapped line hangs under the
                      words it continues rather than back under the bullet.
                      `mt-4` is `SectionCard`'s header-to-body gap, as in the
                      staff-fit panel: `mt-2` crowded both lists 8px closer to
                      their description than "Sizes still missing" sits. */}
          <ul className="mt-4 flex flex-col gap-1 text-sm">
            {checklist.nitroxBlockers.map((blocker) => (
              <li key={blocker.bookingId} className="flex gap-1.5">
                <span aria-hidden="true">•</span>
                {blocker.reason === "identity_held" ? (
                  // A held seat: any card on the matched record may be
                  // somebody else's, so the door is the seat's own
                  // roster row, never that person's record.
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
