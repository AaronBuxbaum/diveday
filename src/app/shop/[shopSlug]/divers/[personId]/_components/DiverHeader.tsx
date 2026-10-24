import type { ReactNode } from "react";
import { ShopPageHeader } from "@/components/ShopPageHeader";
import { buttonClass } from "@/components/ui/button";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { formatCalendarDate, formatCalendarMonth } from "@/lib/calendar-date";
import { mailtoHref, telHref } from "@/lib/contact-links";
import type { DiverStanding } from "@/lib/diver-standing";
import { displayStoredPhone } from "@/lib/forgiving-fields";
import { formatMoneyCents } from "@/lib/format";
import { DiverFormStatus, type DiverNotice } from "./NoticeBanner";
import type { DiverProfile } from "./shared";

/**
 * **The masthead** — who this is, how to reach them, and the record's one
 * primary act (ADR 20260827-people-not-lists, decision 1).
 *
 * The eyebrow is the way back up rather than a separate "← All divers" line
 * above the header: the word that names the parent becomes the door to it, in
 * the page's own column, which is the pattern the settings sub-pages already
 * use.
 *
 * **Add a booking is the page's one primary control**, and the only one:
 * this record used to carry three to four primary-weight buttons and lead with
 * money. Its disclosure sits on the line beneath the header rather than in the
 * header's right-hand column, because the column is the width of its buttons
 * and the picker that drops out of it is a full-width form.
 * `_lib/record-primaries.test.ts` fails the build if a second primary joins it.
 *
 * **The details editor is not here** (ADR 20261001-logbook, decision 2: one
 * page shape, at most one primary action). It sat beside Book as a second
 * dropdown button; it is the first file group now, `DiverDetailsGroup`, a door
 * like every other part of the record.
 */
export function DiverHeader({
  diver,
  shopSlug,
  t,
  status,
  book,
  moment,
  standing,
  locale,
  packages,
  download,
}: {
  diver: DiverProfile;
  shopSlug: string;
  t: StaffTranslator;
  /** A saved-details confirmation, shown under the masthead. A refusal stays on the form. */
  status?: DiverNotice;
  /**
   * The one primary: "Add a booking" and the trip picker it discloses.
   * Absent for a removed diver, who may not be seated onto a boat at all.
   */
  book?: ReactNode;
  /**
   * The record's one earned moment — the coral line that appears when the act
   * a staffer just took cleared the last open item, and nowhere else
   * (20260827-clearwater-surface-language, decision 11).
   */
  moment?: ReactNode;
  /**
   * Who this person is to the shop (fifth-loop ideas, item 36): visits since
   * when, last out, money kept (null unless the reader may see money) and the
   * friends they brought. `src/lib/diver-standing.ts`.
   */
  standing: DiverStanding;
  locale: string;
  /** Dives left on the packages this diver holds (fourth UX review, item 20); null when none. */
  packages?: { left: number; of: number } | null;
  /** "Download record", a secondary beside Book; absent for a reader who may not export. */
  download?: ReactNode;
}) {
  return (
    <>
      <ShopPageHeader
        eyebrow={t("divers.page.title")}
        eyebrowHref={`/shop/${shopSlug}/divers`}
        title={diver.person.fullName}
        align="start"
        meta={
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted">
            {/* `mailtoHref`/`telHref` (src/lib/contact-links.ts), not a template
                string with the sanitizing regex copied in beside it: a shop
                stores a number the way it prints it, and a `tel:` URI carrying
                spaces and parentheses is refused outright by several diallers —
                which is the one tap on this page a staffer makes with a diver
                already on the phone. Both links are button-shaped and go
                through `buttonClass` for it, so the 44px target is structural
                rather than a remembered `min-h-11`.

                **A fact that wraps sits 4px under the links, and that is
                settled** (docs/design/settled-questions.md). A wrapped flex
                line is as tall as what it holds, so "3 visits" on a phone is a
                20px line of its own; the blank above its words is the links'
                44px boxes, which must be their own (axe measures the element,
                see `EYEBROW_TAP_WRAPPER`), and handing their unseen half back
                would run their focus ring through the facts. A line of its own
                at every width changes nothing on a phone and costs every
                desktop record with a visit 24px. */}
            {diver.person.email ? (
              <a
                href={mailtoHref(diver.person.email)}
                // `wrap-anywhere`: a button box keeps the whole address as its
                // narrowest width, so a long one ran off a phone's edge.
                className={buttonClass({
                  variant: "link",
                  size: "sm",
                  flush: true,
                  className: "min-w-0 wrap-anywhere",
                })}
              >
                {diver.person.email}
              </a>
            ) : null}
            {diver.person.phone ? (
              <a
                href={telHref(diver.person.phone)}
                className={buttonClass({ variant: "link", size: "sm", flush: true })}
              >
                {displayStoredPhone(diver.person.phone)}
              </a>
            ) : null}
            {!diver.person.email && !diver.person.phone ? (
              <span>{t("divers.header.noContactDetails")}</span>
            ) : null}
            {diver.person.diveInsurance ? (
              <span>{t("divers.header.diveInsuranceOnFile")}</span>
            ) : null}
            {standing.visits > 0 ? (
              <span className="tabular-nums">
                {standing.since
                  ? t("divers.header.visitsSince", {
                      count: standing.visits,
                      since: formatCalendarMonth(standing.since, locale),
                    })
                  : t("divers.header.visits", { count: standing.visits })}
              </span>
            ) : null}
            {standing.lastOut ? (
              <span className="tabular-nums">
                {t("divers.header.lastOut", {
                  date: formatCalendarDate(standing.lastOut, locale),
                })}
              </span>
            ) : null}
            {standing.spent ? (
              <span className="tabular-nums">
                {t("divers.header.spent", {
                  amount: formatMoneyCents(standing.spent.cents, standing.spent.currency, locale),
                })}
              </span>
            ) : null}
            {standing.friends > 0 ? (
              <span className="tabular-nums">
                {t("divers.header.broughtFriends", { count: standing.friends })}
              </span>
            ) : null}
            {packages ? (
              <span className="tabular-nums">{t("divers.header.packageBalance", packages)}</span>
            ) : null}
          </div>
        }
      />
      {moment}
      {status?.tone === "success" ? <DiverFormStatus status={status} className="-mt-4" /> : null}
      {book || download ? (
        <div className="mt-1 flex flex-wrap items-start gap-2">
          {book}
          {download}
        </div>
      ) : null}
    </>
  );
}
