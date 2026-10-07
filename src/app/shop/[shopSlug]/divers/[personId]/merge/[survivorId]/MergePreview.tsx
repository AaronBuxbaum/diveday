import Link from "next/link";
import { Fragment, type ReactNode } from "react";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { SectionCard } from "@/components/ui/card";
import { ChoicePill, ChoiceRow } from "@/components/ui/form";
import {
  DIVER_MERGE_COUNT_GROUPS,
  DIVER_MERGE_FIELDS,
  type DiverMergeCountGroup,
  type DiverMergeField,
  type DiverMergePreview,
  type DiverMergeRefusal,
  type DiverMergeSide,
  type DiverMergeWarning,
} from "@/db/diver-merge";
import type { StaffMessageKey, StaffTranslator } from "@/i18n/staff-messages";
import { isMinorOnDate } from "@/lib/age";
import {
  calendarDateInTimezone,
  formatCalendarDate,
  isValidCalendarDate,
} from "@/lib/calendar-date";
import { nowDate } from "@/lib/clock";
import { displayStoredPhoneWhole } from "@/lib/forgiving-fields";
import { formatDateTimeTz } from "@/lib/format";
import { shopPath } from "@/lib/staff-notices";
import { DiverFormStatus, type DiverNotice } from "../../_components/NoticeBanner";
import { mergeDiverAction } from "../../actions";

const FIELD_KEYS: Record<DiverMergeField, StaffMessageKey> = {
  fullName: "divers.mergePreview.fields.fullName",
  dateOfBirth: "divers.mergePreview.fields.dateOfBirth",
  email: "divers.mergePreview.fields.email",
  phone: "divers.mergePreview.fields.phone",
  emergencyContact: "divers.mergePreview.fields.emergencyContact",
  rentalFit: "divers.mergePreview.fields.rentalFit",
};

const GROUP_KEYS: Record<DiverMergeCountGroup, StaffMessageKey> = {
  bookings: "divers.mergePreview.groups.bookings",
  releases: "divers.mergePreview.groups.releases",
  cards: "divers.mergePreview.groups.cards",
  orders: "divers.mergePreview.groups.orders",
  notes: "divers.mergePreview.groups.notes",
  messages: "divers.mergePreview.groups.messages",
  reviews: "divers.mergePreview.groups.reviews",
  gear: "divers.mergePreview.groups.gear",
  history: "divers.mergePreview.groups.history",
  lists: "divers.mergePreview.groups.lists",
};

/** The refusal a staffer reads before the button, in the record's own words. */
const REFUSAL_KEYS: Record<Exclude<DiverMergeRefusal, "booking_conflict">, StaffMessageKey> = {
  not_found: "divers.notices.mergeInvalid",
  not_authorized: "divers.notices.notAuthorizedMerge",
  anonymized: "divers.notices.mergeAnonymized",
  already_merged: "divers.notices.mergeAlreadyMerged",
  already_removed: "divers.notices.mergeAlreadyRemoved",
  staff_record: "divers.notices.mergeStaffRecord",
  record_conflict: "divers.notices.mergeRecordConflict",
  different_people_unacknowledged: "divers.notices.mergeDifferentPeopleUnacknowledged",
  departure_underway: "divers.notices.mergeDepartureUnderway",
  assessment_changed: "divers.notices.mergeAssessmentChanged",
};

/** One line per reason to doubt the pair, in the order the transaction finds them. */
const WARNING_KEYS: Record<
  Exclude<DiverMergeWarning, "releases_under_different_names">,
  StaffMessageKey
> = {
  different_birth_dates: "divers.mergePreview.differentBirthDates",
  birth_date_unknown_on_one_record: "divers.mergePreview.birthDateUnknownOnOneRecord",
  both_hold_cards_or_releases: "divers.mergePreview.bothHoldCardsOrReleases",
  open_medical_hold: "divers.mergePreview.medicalAnswerWaiting",
  declined_clearance: "divers.mergePreview.medicalAnswerDeclined",
};

function fieldValue(
  field: DiverMergeField,
  side: DiverMergeSide,
  t: StaffTranslator,
  locale: string,
): string | null {
  switch (field) {
    case "fullName":
      return side.fullName;
    case "dateOfBirth":
      return side.dateOfBirth && isValidCalendarDate(side.dateOfBirth)
        ? formatCalendarDate(side.dateOfBirth, locale)
        : null;
    case "email":
      return side.email;
    case "phone":
      return side.phone ? displayStoredPhoneWhole(side.phone) : null;
    case "emergencyContact": {
      const parts = [
        side.emergencyContactName,
        side.emergencyContactPhone ? displayStoredPhoneWhole(side.emergencyContactPhone) : null,
      ].filter(Boolean);
      return parts.length > 0 ? parts.join(" · ") : null;
    }
    case "rentalFit": {
      const fit = side.rentalFit;
      if (!fit) return null;
      const sizes = [
        fit.bcdSize ? t("divers.mergePreview.sizes.bcd", { size: fit.bcdSize }) : null,
        fit.wetsuitSize ? t("divers.mergePreview.sizes.wetsuit", { size: fit.wetsuitSize }) : null,
        fit.drysuitSize ? t("divers.mergePreview.sizes.drysuit", { size: fit.drysuitSize }) : null,
        fit.bootSize ? t("divers.mergePreview.sizes.boots", { size: fit.bootSize }) : null,
        fit.finSize ? t("divers.mergePreview.sizes.fins", { size: fit.finSize }) : null,
        fit.weightPreference
          ? t("divers.mergePreview.sizes.weights", { size: fit.weightPreference })
          : null,
      ].filter(Boolean);
      return sizes.length > 0 ? sizes.join(" · ") : null;
    }
  }
}

/**
 * **Two records, side by side, before they become one.** The record merged
 * away on the left, the record kept on the right; a field the two disagree on
 * is a choice (the kept record's value preselected), a field they agree on or
 * only one holds is shown and carried. Below it, what each record holds,
 * which is everything that moves. A shared departure refuses the merge with
 * the departures named, as does a seat on a departure that is out now. Every
 * sign of two different people (`DiverMergeWarning`) puts a required
 * acknowledgement in front of the button, and the box posts the exact set it
 * acknowledged. The transaction asks every one of those again.
 */
export function MergePreview({
  preview,
  shopSlug,
  locale,
  timeZone,
  t,
  status,
}: {
  preview: DiverMergePreview;
  shopSlug: string;
  locale: string;
  timeZone: string;
  t: StaffTranslator;
  status?: DiverNotice;
}) {
  const { source, survivor } = preview;
  const conflicts = new Set(preview.conflicts);
  const notOnFile = t("divers.mergePreview.notOnFile");
  // Which date stays decides who must have co-signed: a minor's release
  // without a guardian's signature blocks the seat (`guardianSignatureMissing`).
  const today = calendarDateInTimezone(nowDate(), timeZone);
  const isMinor = (side: DiverMergeSide) =>
    Boolean(
      side.dateOfBirth &&
        isValidCalendarDate(side.dateOfBirth) &&
        isMinorOnDate(side.dateOfBirth, today),
    );
  const minorDateInPlay =
    conflicts.has("dateOfBirth") && (isMinor(source) || isMinor(survivor)) && !preview.refusal;

  const cell = (field: DiverMergeField, side: DiverMergeSide, choice: "source" | "survivor") => {
    const value = fieldValue(field, side, t, locale);
    if (conflicts.has(field) && value) {
      return (
        <ChoicePill
          type="radio"
          name={`keep_${field}`}
          value={choice}
          defaultChecked={choice === "survivor"}
          aria-label={t("divers.mergePreview.keepValue", { value })}
        >
          {value}
        </ChoicePill>
      );
    }
    return value ?? <span className="text-muted">{notOnFile}</span>;
  };

  const counted = (side: DiverMergeSide, group: DiverMergeCountGroup) => side.counts[group];
  const moveRows: { key: string; label: string; source: number; survivor: number }[] = [];
  for (const group of Object.keys(DIVER_MERGE_COUNT_GROUPS) as DiverMergeCountGroup[]) {
    moveRows.push({
      key: group,
      label: t(GROUP_KEYS[group]),
      source: counted(source, group),
      survivor: counted(survivor, group),
    });
    if (group === "releases") {
      moveRows.push({
        key: "medicalAnswers",
        label: t("divers.mergePreview.groups.medicalAnswers"),
        source: source.medicalAnswers,
        survivor: survivor.medicalAnswers,
      });
    }
  }
  const shownMoves = moveRows.filter((row) => row.source > 0 || row.survivor > 0);

  // A medical answer still open on a side is said on that side, in danger tone:
  // it is the one thing a newer release on the other record could quietly stand
  // over once the two are one.
  const medicalFlags = (side: DiverMergeSide) =>
    side.medical.openMedicalHold || side.medical.declinedClearance ? (
      <span className="mt-1 block text-xs font-medium text-danger">
        {side.medical.declinedClearance
          ? t("divers.mergePreview.declinedClearance")
          : t("divers.mergePreview.openMedicalHold")}
      </span>
    ) : null;

  const header = (
    <tr>
      <th scope="col" className="w-1/4 pb-2 text-start font-normal text-muted">
        <span className="sr-only">{t("divers.mergePreview.detailsHeading")}</span>
      </th>
      <th scope="col" className="pb-2 text-start font-semibold">
        <span className="block text-xs font-normal text-muted">
          {t("divers.mergePreview.mergedAway")}
        </span>
        {source.fullName}
        {medicalFlags(source)}
      </th>
      <th scope="col" className="pb-2 text-start font-semibold">
        <span className="block text-xs font-normal text-muted">
          {t("divers.mergePreview.kept")}
        </span>
        {survivor.fullName}
        {medicalFlags(survivor)}
      </th>
    </tr>
  );

  let refusal: ReactNode = null;
  if (preview.refusal === "booking_conflict") {
    refusal = (
      <div className="text-sm text-danger">
        <p className="font-medium">{t("divers.mergePreview.bookingConflict")}</p>
        <ul className="mt-2 grid gap-1">
          {preview.sharedDepartures.map((departure) => (
            <li key={departure.tripId}>
              <Link
                href={shopPath(shopSlug, "trips", departure.tripId)}
                className="font-semibold text-primary hover:underline"
              >
                {departure.title} · {formatDateTimeTz(departure.startsAt, locale, timeZone)}
              </Link>
            </li>
          ))}
        </ul>
      </div>
    );
  } else if (preview.refusal) {
    refusal = <p className="text-sm font-medium text-danger">{t(REFUSAL_KEYS[preview.refusal])}</p>;
  }

  return (
    <form action={mergeDiverAction.bind(null, shopSlug, source.id)} className="space-y-10">
      <input type="hidden" name="survivorId" value={survivor.id} />
      <SectionCard title={t("divers.mergePreview.detailsHeading")}>
        {conflicts.size > 0 && !preview.refusal ? (
          <p className="-mt-2 mb-4 text-sm text-muted">{t("divers.mergePreview.chooseHint")}</p>
        ) : null}
        <table className="w-full table-fixed border-collapse text-sm [overflow-wrap:anywhere]">
          <thead>{header}</thead>
          <tbody>
            {DIVER_MERGE_FIELDS.map((field) => (
              <Fragment key={field}>
                <tr className="border-t border-border align-top">
                  <th scope="row" className="py-3 pe-3 text-start font-normal text-muted">
                    {t(FIELD_KEYS[field])}
                  </th>
                  <td className="py-3 pe-3">{cell(field, source, "source")}</td>
                  <td className="py-3">{cell(field, survivor, "survivor")}</td>
                </tr>
                {field === "dateOfBirth" && minorDateInPlay ? (
                  <tr>
                    <td />
                    <td colSpan={2} className="pb-3 text-sm text-warning-strong">
                      {t("divers.mergePreview.birthDateMinorHint")}
                    </td>
                  </tr>
                ) : null}
              </Fragment>
            ))}
          </tbody>
        </table>
        <p className="mt-4">
          <Link
            href={shopPath(shopSlug, "divers", survivor.id, "merge", source.id)}
            className={buttonClass({ variant: "link", size: "sm", flush: true })}
          >
            {t("divers.mergePreview.swap", { name: source.fullName })}
          </Link>
        </p>
      </SectionCard>

      <SectionCard title={t("divers.mergePreview.movesHeading")}>
        {shownMoves.length > 0 ? (
          <table className="w-full table-fixed border-collapse text-sm">
            <thead>
              <tr>
                <th scope="col" className="w-1/2 pb-2 text-start font-normal text-muted">
                  <span className="sr-only">{t("divers.mergePreview.movesHeading")}</span>
                </th>
                <th scope="col" className="pb-2 text-end font-normal text-muted">
                  {t("divers.mergePreview.mergedAway")}
                </th>
                <th scope="col" className="pb-2 text-end font-normal text-muted">
                  {t("divers.mergePreview.kept")}
                </th>
              </tr>
            </thead>
            <tbody>
              {shownMoves.map((row) => (
                <tr key={row.key} className="border-t border-border">
                  <th scope="row" className="py-2 text-start font-normal">
                    {row.label}
                  </th>
                  <td className="py-2 text-end font-semibold tabular-nums">{row.source}</td>
                  <td className="py-2 text-end tabular-nums text-muted">{row.survivor}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="text-sm text-muted">{t("divers.mergePreview.nothingToMove")}</p>
        )}
      </SectionCard>

      <section id="merge" className="space-y-4">
        {refusal}
        {!preview.refusal && preview.warnings.length > 0 ? (
          <div className="rounded-panel border border-warning p-4 text-sm">
            <h2 className="font-semibold text-warning-strong">
              {t("divers.mergePreview.differentPeopleHeading")}
            </h2>
            <ul className="mt-2 grid gap-1">
              {preview.warnings.map((warning) => (
                <li key={warning}>
                  {warning === "releases_under_different_names"
                    ? t("divers.mergePreview.releasesUnderDifferentNames", {
                        names: preview.releaseNames.join(" · "),
                      })
                    : t(WARNING_KEYS[warning])}
                </li>
              ))}
            </ul>
            <ChoiceRow
              type="checkbox"
              name="acknowledgement"
              value={preview.acknowledgement}
              required
              className="mt-3 font-medium"
            >
              {t("divers.mergePreview.acknowledge")}
            </ChoiceRow>
          </div>
        ) : null}
        <div className="flex flex-wrap items-center gap-3">
          {preview.refusal ? null : (
            <SubmitButton
              pendingLabel={t("divers.mergePreview.pending")}
              confirmMessage={t("divers.mergePreview.confirm", {
                source: source.fullName,
                kept: survivor.fullName,
              })}
              className={buttonClass({ variant: "danger" })}
            >
              {t("divers.mergePreview.submit", { name: survivor.fullName })}
            </SubmitButton>
          )}
          <DiverFormStatus status={status} />
        </div>
      </section>
    </form>
  );
}
