import Link from "next/link";
import { SectionCard, TONE_PANEL_CLASS } from "@/components/ui/card";
import { SECTION_TITLE_CLASS } from "@/components/ui/typography";
import { rentalItemLabel, statedSizesText } from "@/i18n/rental-labels";
import { scopedId } from "@/lib/element-id";
import { cachedListFormat } from "@/lib/intl-cache";
import { nameLinkClass } from "./prep-lines";
import type { PrepView } from "./prep-view";

/** Who the list cannot pack for yet: sizes missing, seats held, fits only staff can do. */
export function PrepFitGaps({ view }: { view: PrepView }) {
  const { prep, t, locale, shopSlug, idPrefix } = view;
  const { checklist } = prep;
  // The "Sizes still missing" card's two halves, sorted once: each is drawn
  // only when it has somebody in it.
  const partialFit = checklist.diversWithIncompleteFit.filter(
    (diver) => diver.state !== "not_recorded",
  );
  const neverAsked = checklist.diversWithIncompleteFit.filter(
    (diver) => diver.state === "not_recorded",
  );
  return (
    <>
      {/* Two gaps, one section, and each row says which it is. This used to
              be "No rental fit on file", which was true of everyone in it back
              when a fit was counted by the row existing. Now that it is counted
              per item, most of this list is divers somebody *did* ask — and
              telling the packer nobody asked would send them to re-ask a
              question that already has half an answer. */}
      {checklist.diversWithIncompleteFit.length > 0 ? (
        <SectionCard
          title={t("tripPrep.missingSizesHeading")}
          description={t("tripPrep.missingSizesDescription")}
        >
          {/* Two different situations, said differently: a diver with
                  *some* sizes on file keeps a row naming exactly what's
                  missing, while the never-asked share one sentence said once
                  above their names — the old list repeated "nothing on file;
                  they may be bringing their own kit…" per row, the same clause
                  chanted seven times (principle 9). One gap between the two,
                  and only when both are there: an empty partial list used to
                  hold the never-asked block's `mt-3` open under the
                  description, a blank line that read as a missing row. */}
          <div className="flex flex-col gap-3 text-sm">
            {partialFit.length > 0 ? (
              <ul className="flex flex-col gap-1">
                {partialFit.map((diver) => (
                  <li key={diver.personId} className="flex gap-1.5">
                    <span aria-hidden="true">•</span>
                    <span>
                      <Link
                        href={`/shop/${shopSlug}/divers/${diver.personId}`}
                        className="font-medium hover:text-primary hover:underline"
                      >
                        {diver.fullName}
                      </Link>{" "}
                      <span className="text-muted">
                        {t("tripPrep.missingSizesItems", {
                          items: cachedListFormat(locale, {
                            style: "long",
                            type: "conjunction",
                          }).format(diver.missing.map((kind) => rentalItemLabel(t, kind))),
                        })}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}
            {neverAsked.length > 0 ? (
              <div>
                <p className="text-muted">{t("tripPrep.missingSizesNobodyAskedLead")}</p>
                {/* `gap-y-6`, twice the 12px each name's target
                            reaches above and below its 20px line: wrapped
                            rows sit 44px apart and their targets meet. At
                            `gap-y-1` the second row's targets reached over
                            the names above them, and won the tap. */}
                <ul className="mt-1 flex flex-wrap gap-x-3 gap-y-6">
                  {neverAsked.map((diver) => (
                    <li key={diver.personId}>
                      <Link
                        href={`/shop/${shopSlug}/divers/${diver.personId}`}
                        className={nameLinkClass}
                      >
                        {diver.fullName}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        </SectionCard>
      ) : null}

      {/* A held seat's sizes and nitrox card are the matched
                  record's, which may be somebody else's (issue #2144). Its
                  names are said once here, so nobody packs from that record
                  or fills a fit onto it. */}
      {checklist.heldSeats.length > 0 ? (
        <SectionCard
          title={t("tripPrep.heldSeatsHeading")}
          description={t("tripPrep.heldSeatsDescription")}
        >
          <ul className="flex flex-wrap gap-x-3 gap-y-1 text-sm">
            {checklist.heldSeats.map((seat) => (
              <li key={seat.bookingId} className="font-medium">
                {seat.paidFor.length > 0
                  ? t("tripPrep.heldSeatPaidFor", {
                      name: seat.fullName,
                      pieces: cachedListFormat(locale, {
                        style: "long",
                        type: "conjunction",
                      }).format(seat.paidFor.map((kind) => rentalItemLabel(t, kind))),
                    })
                  : seat.fullName}
              </li>
            ))}
          </ul>
        </SectionCard>
      ) : null}

      {checklist.diversNeedingStaffFit.length > 0 ? (
        <section
          aria-labelledby={scopedId(idPrefix, "staff-fit-heading")}
          className={`${TONE_PANEL_CLASS} border-warning/40 bg-warning/5`}
        >
          <h2 id={scopedId(idPrefix, "staff-fit-heading")} className={SECTION_TITLE_CLASS}>
            {t("tripPrep.staffFitHeading")}
          </h2>
          <p className="mt-1 text-sm text-muted">{t("tripPrep.staffFitDescription")}</p>
          <ul className="mt-4 flex flex-col gap-1 text-sm">
            {checklist.diversNeedingStaffFit.map((diver) => (
              <li key={diver.personId} className="flex gap-1.5">
                <span aria-hidden="true">•</span>
                <span>
                  <Link
                    href={`/shop/${shopSlug}/divers/${diver.personId}`}
                    className="font-medium hover:text-primary hover:underline"
                  >
                    {diver.fullName}
                  </Link>
                  {diver.note ? <span className="text-muted"> — {diver.note}</span> : null}
                  {/* What they asked for. The captain doing the fit can't edit
                          the profile and sees no size on the packing line, so
                          without this there is nothing to bring a range around. */}
                  {diver.statedSizes.length > 0 ? (
                    <span className="text-muted">
                      {" "}
                      {t("tripPrep.askedFor", {
                        sizes: statedSizesText(t, locale, diver.statedSizes),
                      })}
                    </span>
                  ) : (
                    <span className="text-muted"> {t("tripPrep.noSizesOnFile")}</span>
                  )}
                  {/* How old the flag is: a shortage is about one day, so a
                          months-old flag is a prompt to re-ask, not to trust. */}
                  <span className="text-muted">
                    {" "}
                    {t("tripPrep.flaggedAgo", {
                      when:
                        diver.flaggedDaysAgo === 0
                          ? t("tripPrep.today")
                          : diver.flaggedDaysAgo === 1
                            ? t("tripPrep.yesterday")
                            : t("tripPrep.daysAgo", { count: diver.flaggedDaysAgo }),
                    })}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </>
  );
}
