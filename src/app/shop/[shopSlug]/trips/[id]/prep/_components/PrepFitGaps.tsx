import Link from "next/link";
import { tapTargetLinkClass } from "@/components/ui/button";
import { SectionCard, TONE_PANEL_CLASS } from "@/components/ui/card";
import { SECTION_TITLE_CLASS } from "@/components/ui/typography";
import { rentalItemLabel, statedSizesText } from "@/i18n/rental-labels";
import { scopedId } from "@/lib/element-id";
import { cachedListFormat } from "@/lib/intl-cache";
import type { PrepView } from "./prep-view";

/** Who the list cannot pack for yet: sizes missing, seats held, fits only staff can do. */
export function PrepFitGaps({ view }: { view: PrepView }) {
  const { prep, t, locale, shopSlug, idPrefix } = view;
  const { checklist } = prep;
  // Separate partial fits from seats that have never been asked.
  const partialFit = checklist.diversWithIncompleteFit.filter(
    (diver) => diver.state !== "not_recorded",
  );
  const neverAsked = checklist.diversWithIncompleteFit.filter(
    (diver) => diver.state === "not_recorded",
  );
  return (
    <>
      {/* Keep partial fits distinct from seats never asked, so staff can see
          what is missing without treating an existing answer as no fit. */}
      {checklist.diversWithIncompleteFit.length > 0 ? (
        // The packing-list item itself says when its size is missing.
        <SectionCard title={t("tripPrep.missingSizesHeading")}>
          {/* Partial fits name each missing item; never-asked seats share one
              lead. Keep a gap only when both groups are present. */}
          <div className="flex flex-col gap-3 text-sm">
            {partialFit.length > 0 ? (
              <ul className="flex flex-col gap-1">
                {partialFit.map((diver) => (
                  <li key={diver.personId} className="flex gap-1.5">
                    <span aria-hidden="true">•</span>
                    <span>
                      <Link
                        href={`/shop/${shopSlug}/divers/${diver.personId}`}
                        className={`${tapTargetLinkClass} py-3 -my-3 print:min-h-0 print:py-0 print:my-0 font-medium hover:text-primary hover:underline`}
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
              // Keep the lead and names in one paragraph, with each name linked.
              <p>
                <span className="text-muted">{t("tripPrep.missingSizesNobodyAskedLead")}</span>{" "}
                {/* Preserve locale-specific separators and each linked name. */}
                {(() => {
                  let at = 0;
                  return cachedListFormat(locale, { style: "short", type: "unit" })
                    .formatToParts(neverAsked.map((diver) => diver.fullName))
                    .map((part) => {
                      if (part.type !== "element") return part.value;
                      const diver = neverAsked[at++];
                      if (!diver) return part.value;
                      return (
                        <Link
                          key={diver.personId}
                          href={`/shop/${shopSlug}/divers/${diver.personId}`}
                          className={`${tapTargetLinkClass} py-3 -my-3 print:min-h-0 print:py-0 print:my-0 font-medium hover:text-primary hover:underline`}
                        >
                          {diver.fullName}
                        </Link>
                      );
                    });
                })()}
              </p>
            ) : null}
          </div>
        </SectionCard>
      ) : null}

      {/* A held seat may match somebody else's identity. Keep its details
          visible without treating them as the diver's fit or card. */}
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
                    className={`${tapTargetLinkClass} py-3 -my-3 print:min-h-0 print:py-0 print:my-0 font-medium hover:text-primary hover:underline`}
                  >
                    {diver.fullName}
                  </Link>
                  {diver.note ? <span className="text-muted"> — {diver.note}</span> : null}
                  {/* Show stated sizes so staff can bring the right range. */}
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
                  {/* Flag age helps staff decide whether to confirm the request. */}
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
