import Link from "next/link";
import { EmptyState } from "@/components/EmptyState";
import { SubmitButton } from "@/components/SubmitButton";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { sectionCardClass } from "@/components/ui/card";
import { controlClass, Field, FieldGrid, FormStatus } from "@/components/ui/form";
import type { TripLastMinutePromo } from "@/db/schema";
import type { CertificationSummary } from "@/db/self-declared-cards";
import type { TripLastMinutePromoRecipientItem } from "@/db/trip-promos";
import {
  CERTIFICATION_LEVEL_KEYS,
  certificationSummaryBelowRequirementText,
  certificationSummaryText,
  certificationSummaryUnchecked,
  SPECIALTY_KEYS,
} from "@/i18n/readiness-labels";
import { type StaffMessageKey, staffTranslator } from "@/i18n/staff-messages";
import { formatDateTimeTz } from "@/lib/format";
import { cachedListFormat } from "@/lib/intl-cache";
import { reviewLastMinuteRecipients } from "@/lib/last-minute-list";
import type { CertRequirementSource } from "@/lib/readiness";
import type { FormNotice } from "@/lib/staff-notices";

const STATUS_TONE: Record<TripLastMinutePromo["status"], BadgeTone> = {
  sent: "success",
  pending: "neutral",
  failed: "danger",
};

// A raw `status` enum value is a database detail, not copy — the badge shows
// the translated label the bundle carries for it (docs ADR
// 20260730-staff-copy-localization), the same shape as `promos.status`.
const STATUS_KEYS: Record<TripLastMinutePromo["status"], StaffMessageKey> = {
  sent: "trips.lastMinute.status.sent",
  pending: "trips.lastMinute.status.pending",
  failed: "trips.lastMinute.status.failed",
};

/**
 * The fill-the-boat lever: push a time-boxed Stripe discount code to every
 * last-minute-list diver whose date range covers this trip (docs ADR
 * 20260727-last-minute-fill-promos). A deliberate form submit, not a one-tap
 * control like the wait-list invite — the discount percent is a real
 * commercial choice.
 */
/**
 * One person this blast would reach, with what the shop knows about their
 * diving. `LastMinuteDealRecipient` rather than a raw person row because this
 * panel needs exactly two things — a name to read and a claim to weigh — and
 * nothing else about the diver belongs on a "who is this going to" list.
 */
export type LastMinuteDealRecipient = {
  personId: string;
  fullName: string;
  certification: CertificationSummary | null;
};

export function LastMinuteDealSection({
  shopSlug,
  recipients,
  requirement,
  openSeats,
  cancelled,
  promos,
  promoRecipients,
  timezone,
  locale,
  status,
  sendAction,
}: {
  /**
   * What the last blast did. This section is the reason `FormStatus` exists:
   * its action redirects to `#last-minute-deal`, which scrolls the page's own
   * banner off the top of the screen on the way in — so the answer to "did
   * that send?" was reliably somewhere the staffer could not see.
   */
  status?: FormNotice;
  /** Only used by the cancelled empty state's way out, back to the board. */
  shopSlug: string;
  recipients: readonly LastMinuteDealRecipient[];
  requirement: CertRequirementSource | null;
  openSeats: number;
  cancelled: boolean;
  promos: TripLastMinutePromo[];
  promoRecipients?: TripLastMinutePromoRecipientItem[];
  timezone: string;
  locale: string;
  sendAction: (formData: FormData) => void;
}) {
  const t = staffTranslator(locale);
  const eligibleCount = recipients.length;
  const canSend = !cancelled && openSeats > 0 && eligibleCount > 0;
  const requiredLevel = requirement?.minimumCertificationLevel ?? null;
  // Risky names first, capped, with the two counts the sentence below is made
  // of. The send itself is untouched — `eligibleCount` above is still everyone.
  // The whole requirement goes in, not just the rung: a joiner who said they
  // hold no card is below a Deep-and-nitrox charter too, and that departure has
  // no minimum level for anyone to be compared against.
  const review = reviewLastMinuteRecipients(recipients, requirement);
  /**
   * The gate in the trip's own words, reusing the requirements panel's phrases
   * so one departure does not describe itself two ways on two screens.
   *
   * Specialties and nitrox ride along even though only the level orders. A line
   * that named the minimum level and quietly dropped a required Deep card would
   * be a shorter truth than the trip's, on the screen where a staffer decides
   * who to invite onto it.
   */
  const requirementParts = [
    requiredLevel
      ? t("trips.requirements.certOrHigher", { level: t(CERTIFICATION_LEVEL_KEYS[requiredLevel]) })
      : null,
    ...(requirement?.requiredSpecialties ?? []).map((specialty) =>
      t("trips.requirements.specialtyRequired", { specialty: t(SPECIALTY_KEYS[specialty]) }),
    ),
    requirement?.requiresNitrox ? t("trips.requirements.nitroxCardRequired") : null,
  ].filter((part): part is string => Boolean(part));
  /**
   * **The one sentence a busy person can act on.** The list answers "who",
   * which takes a scroll; this answers "is there anything wrong with this
   * send", which is the question being asked at the button.
   *
   * Four shapes, and none of them is a zero: "0 said a level below" is a
   * statistic a reader has to interpret, while "nobody did" is an answer. A
   * departure that asks for no level says that instead, because there is
   * nothing for a level to be below.
   *
   * The fourth shape is the honest one, and it was missing. **Only the ladder
   * orders**, so a departure gated on a Deep card and nitrox rather than a
   * level has `requiredLevel === null` — and the no-requirement sentence then
   * read as an all-clear on a send where `decideTripAdmission` will refuse
   * every recipient at checkout. Now it names what it cannot speak to. Marking
   * the missing specialty per row would be better still and is a bigger change
   * than this one; saying so is the floor.
   *
   * The count comes first when there is one, because on a card-gated departure
   * both can be true at once: the fold *can* place the joiner who says they
   * hold no card, and cannot place anybody else. Saying only the second would
   * bury the one name it can name; saying only the first would read as an
   * all-clear over the rest of the list.
   */
  const cardsCaveat =
    requiredLevel === null && requirementParts.length > 0
      ? t("trips.lastMinute.recipientsSummaryNoLevelButCards", {
          list: cachedListFormat(locale, { style: "long", type: "conjunction" }).format(
            requirementParts,
          ),
        })
      : null;
  const summary =
    review.below > 0
      ? `${t("trips.lastMinute.recipientsSummaryBelow", {
          count: review.below,
          total: review.total,
        })}${cardsCaveat ? ` ${cardsCaveat}` : ""}`
      : (cardsCaveat ??
        (requiredLevel === null
          ? t("trips.lastMinute.recipientsSummaryNoRequirement")
          : t("trips.lastMinute.recipientsSummaryNoneBelow")));
  return (
    // No top margin of its own: this renders inside a disclosure panel that
    // owns its inset. `scroll-mt-6` stays — the send action redirects to this
    // element's own `#last-minute-deal` anchor.
    <section id="last-minute-deal" className="scroll-mt-6">
      <h2 className="text-lg font-semibold">{t("trips.lastMinute.heading")}</h2>
      <p className="mt-1 text-sm text-muted">{t("trips.lastMinute.description")}</p>

      {canSend ? (
        <form
          action={sendAction}
          className={sectionCardClass({
            className: "mt-4 flex flex-wrap items-end gap-3",
          })}
        >
          {/* **The list, then the button.** It used to be the other way round,
              and the comment here called that a virtue — the list "sits under
              the discount field the staffer just set and the button they are
              about to press". On a phone that reads as: the button is on
              screen and the list is not, so one tap sends a discount to people
              whose levels were never rendered above the fold. Reading order is
              the safeguard, so it is DOM order and not an `order-*` class: a
              screen reader has to meet the recipients before it meets Send
              too. Everything a staffer must weigh — what the departure
              demands, who it would reach, and the one sentence about the gap
              between them — now sits between them and the control. */}
          <div className="basis-full">
            <h3 className="text-sm font-medium">{t("trips.lastMinute.recipientsHeading")}</h3>
            {requirementParts.length > 0 ? (
              <p className="mt-1 text-sm font-medium">
                {t("trips.lastMinute.recipientsRequirement", {
                  list: cachedListFormat(locale, { style: "long", type: "conjunction" }).format(
                    requirementParts,
                  ),
                })}
              </p>
            ) : null}

            {/* A default range, not a `Pager` — deliberately, and against ADR
                20260803-one-pagination-model's "every paged staff list wears
                Pager". `Pager` navigates the page's own URL, and this `<ul>`
                is *inside the send form*: paging to see recipient 11 would
                throw away the discount percent the staffer had just typed, on
                the one surface where that number is a real commercial choice.
                AGENTS.md allows the other shape ("pagination (or a default
                range)"), so this renders the first
                `LAST_MINUTE_RECIPIENT_PREVIEW_LIMIT` and states the remainder.
                The cap is only safe because the ordering puts anyone below the
                requirement first — see `reviewLastMinuteRecipients`. */}
            <ul className="mt-2 divide-y divide-border rounded-lg border border-border bg-surface-sunken">
              {review.shown.map(({ recipient, belowRequirement }) => (
                <li
                  key={recipient.personId}
                  className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-3 py-2 text-sm"
                >
                  <label className="flex items-center gap-2 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      name="recipientPersonIds"
                      value={recipient.personId}
                      defaultChecked
                      className="rounded border-border text-primary focus:ring-primary"
                    />
                    <span className="font-medium">{recipient.fullName}</span>
                  </label>
                  <span
                    className={
                      certificationSummaryUnchecked(recipient.certification)
                        ? "text-warning"
                        : "text-muted"
                    }
                  >
                    {belowRequirement
                      ? certificationSummaryBelowRequirementText(t, recipient.certification, locale)
                      : certificationSummaryText(t, recipient.certification, locale)}
                  </span>
                </li>
              ))}
            </ul>
            {review.hidden > 0 ? (
              <p className="mt-2 text-sm text-muted">
                {requiredLevel
                  ? t("trips.lastMinute.recipientsMore", { count: review.hidden })
                  : t("trips.lastMinute.recipientsMoreNoRequirement", { count: review.hidden })}
              </p>
            ) : null}
          </div>
          {/* Warning-toned only when there is something to warn about, and the
              words carry it either way (design/principles.md #6). It never
              disables the button: informing is the design
              (ADR 20260814-self-declared-cards). */}
          <p
            className={
              review.below > 0
                ? "basis-full text-sm font-medium text-warning-strong"
                : "basis-full text-sm text-muted"
            }
          >
            {summary}
            {review.notSaid > 0 ? (
              <> {t("trips.lastMinute.recipientsSummaryNotSaid", { count: review.notSaid })}</>
            ) : null}
          </p>
          <FieldGrid columns={1} className="max-w-28">
            <Field label={t("trips.lastMinute.discountLabel")}>
              <div className="flex items-center gap-1.5">
                <input
                  name="discountPercent"
                  type="number"
                  inputMode="numeric"
                  min={5}
                  max={90}
                  step={5}
                  defaultValue={25}
                  aria-label={t("trips.lastMinute.discountPercentAriaLabel")}
                  className={controlClass}
                />
                <span className="text-sm text-muted">%</span>
              </div>
            </Field>
          </FieldGrid>
          <SubmitButton
            pendingLabel={t("trips.lastMinute.sending")}
            className={buttonClass({ className: "px-5 py-2.5" })}
          >
            {t("trips.lastMinute.sendTo", { count: eligibleCount })}
          </SubmitButton>
          <FormStatus tone={status?.tone} className="basis-full">
            {status?.text}
          </FormStatus>
        </form>
      ) : (
        // Three different reasons there is no send button, each with the one
        // door that helps from here: a cancelled boat sends you back to the
        // schedule, a full boat to the wait list this trip already keeps, and
        // an empty last-minute list to seating someone by hand.
        <EmptyState className="mt-4">
          <h3 className="font-medium">
            {cancelled
              ? t("trips.lastMinute.cancelledHeading")
              : openSeats <= 0
                ? t("trips.lastMinute.fullHeading")
                : t("trips.lastMinute.noneAroundHeading")}
          </h3>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted">
            {cancelled
              ? t("trips.lastMinute.cancelledNotice")
              : openSeats <= 0
                ? t("trips.lastMinute.fullNotice")
                : t("trips.lastMinute.noneAroundNotice")}
          </p>
          {cancelled ? (
            <Link
              href={`/shop/${shopSlug}/schedule/board`}
              className={buttonClass({ variant: "secondary", size: "sm", className: "mt-4" })}
            >
              {t("trips.lastMinute.cancelledAction")}
            </Link>
          ) : (
            <a
              href={openSeats <= 0 ? "#waitlist" : "#add-diver"}
              className={buttonClass({ variant: "secondary", size: "sm", className: "mt-4" })}
            >
              {openSeats <= 0
                ? t("trips.lastMinute.fullAction")
                : t("trips.lastMinute.noneAroundAction")}
            </a>
          )}
        </EmptyState>
      )}

      {promos.length > 0 ? (
        <ol
          className={sectionCardClass({
            padding: "none",
            className: "mt-4 divide-y divide-border",
          })}
        >
          {promos.map((promo) => {
            const sentRecipients = promoRecipients?.filter((r) => r.promoId === promo.id) ?? [];
            return (
              <li key={promo.id} className="flex flex-col gap-2 px-4 py-3 text-sm">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium">
                      {t("trips.lastMinute.percentOff", { percent: promo.discountPercent })} ·{" "}
                      <span className="font-mono">{promo.code}</span>
                    </p>
                    <p className="text-muted">
                      {t("trips.lastMinute.sentTo", {
                        date: formatDateTimeTz(promo.createdAt, locale, timezone),
                        count: promo.recipientCount,
                      })}
                    </p>
                  </div>
                  <Badge tone={STATUS_TONE[promo.status]}>{t(STATUS_KEYS[promo.status])}</Badge>
                </div>
                {sentRecipients.length > 0 ? (
                  <p className="text-xs text-muted">
                    {t("trips.lastMinute.recipients", {
                      names: sentRecipients.map((r) => r.fullName).join(", "),
                    })}
                  </p>
                ) : null}
              </li>
            );
          })}
        </ol>
      ) : null}
    </section>
  );
}
