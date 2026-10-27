import Link from "next/link";
import { RowMenu } from "@/components/RowMenu";
import { DiveDayIcon } from "@/components/StaffDestinationIcon";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { LedgerRow } from "@/components/ui/ledger";
import { menuRowClass } from "@/components/ui/menu";
import type { DateInterestRow } from "@/db/interest-dates";
import type { StaffMessageKey, StaffTranslator } from "@/i18n/staff-messages";
import type { CourseInquiryExperience } from "@/lib/course-inquiry";
import { displayStoredPhone } from "@/lib/forgiving-fields";
import { formatShortDate } from "@/lib/format";
import { shopPath } from "@/lib/staff-notices";

/**
 * Where a diver is up to, in staff words. `src/db` returns the code and this
 * picks the sentence (ADR 20260731-domain-layer-copy-leaks).
 */
const EXPERIENCE_KEYS: Record<CourseInquiryExperience, StaffMessageKey> = {
  never: "requests.experience.never",
  tried: "requests.experience.tried",
  certified: "requests.experience.certified",
  lapsed: "requests.experience.lapsed",
};

/**
 * A line's separator, glued to what it follows by a no-break space: a wrap
 * falls after a dot, never before one, so no line of a request starts with
 * "· Asked" (the departure log's `CertificationLine` does the same).
 */
const SEPARATOR = " · ";

/**
 * **A 44px target that leaves its line alone** (principles.md §2; pixel-craft
 * class 7, K-458). The row's two own links sit in lines of text — the name in
 * its 24px line, the address in a 20px one — and a `min-h-11` box would push
 * every line under them 20px or more down. So each keeps its line and
 * stretches an `::after` to 44px, which the rubric counts as the target as far
 * as nothing clips it (docs/design/pixel-craft.md, "Targets"); nothing in the
 * row clips. The name's flex box is 24px, so 10px a side; the address is a
 * 20px inline block, so 12. A block rather than an inline run, because an
 * inline link split over two lines would stretch its overlay across both.
 */
const NAME_TARGET = "relative after:absolute after:inset-x-0 after:-inset-y-2.5";
const ADDRESS_TARGET =
  "relative inline-block max-w-full wrap-anywhere after:absolute after:inset-x-0 after:-inset-y-3";

/**
 * **One request, as a ledger row** (ADR 20260827-people-not-lists, decision 5;
 * the language is 20260827-clearwater-surface-language).
 *
 * A request is a diver asking for a departure to *exist* — a
 * date interest (ADR 20261017-one-interest-with-a-scope),
 * never the wait list and never a last-minute deal. So the row's job is to say
 * who asked, what for, how many of them, and why it is filed under the day it
 * is filed under; the act that answers it belongs to the day group above.
 *
 * **This is the request's one full rendering.** A request lands in every group
 * it could make — first choice, fallback, and every day a flexible one can
 * travel to — and it used to be printed whole under each of them; five divers
 * each appeared twice on one screen with identical four-line bodies. The full
 * record renders under `homeDate` (`src/lib/date-requests.ts`) and every other
 * group gets a one-line `RequestReferenceRow` pointing here, which is why this
 * row no longer has a soft state: it is only ever the day the diver named.
 *
 * Two things this row deliberately does not do:
 *
 * - **No tint and no pill.** A second choice used to arrive as a
 *   `bg-surface-sunken` card wearing a neutral `Badge`. A tinted fill is a
 *   second pill grammar by the back door, and a badge on a row that is only
 *   ever an interest is a state word where the group header already owns the day.
 *   `RequestLedgerRow.test.tsx` pins the absence.
 * - **It carries no status word.** An open request is an interest; a closed one
 *   leaves its day for the Done list (`RequestDoneRow`, third UX review item
 *   13), so the state is where the row sits, never a badge on it.
 *
 * The name is the door when this interest is linked to a diver on file
 * (`personId`: an exact email match, made at capture time and again on every
 * read, so a diver added after they asked still gets their door —
 * `withRosterLinks` in `src/db/interest-dates.ts`). Most requests are strangers, so
 * most rows have no door at all: a stretched row link over a list where one row
 * in four is tappable is a promise the surface cannot keep, and the row's own
 * acts — mailing them, seating them — have to stay reachable either way.
 */
export function RequestLedgerRow({
  request,
  locale,
  timezone,
  shopSlug,
  shopName,
  markDoneAction,
  openDeparture,
  t,
}: {
  request: DateInterestRow;
  /**
   * The day's one act, on each request it answers (visual review A23): the
   * group header no longer carries it. A text link at the row's quiet
   * weight, not a button: eleven rows read as eleven buttons. Absent on the
   * undated tail.
   */
  openDeparture?: { href: string; label: string };
  locale: string;
  timezone: string;
  shopSlug: string;
  /** Names the reply's subject line, so the diver knows who is writing. */
  shopName: string;
  /** Closes the interest (third UX review, item 13); posts `requestId` and `outcome`. */
  markDoneAction: (formData: FormData) => void;
  t: StaffTranslator;
}) {
  const name = request.name ?? t("requests.anonymous");
  const ask = request.courseTitle
    ? t("requests.aboutCourse", { course: request.courseTitle })
    : t("requests.aboutDive", { interest: request.interest ?? "" });

  // The row's quiet facts, in planning order: how many of them, where they are
  // up to, why they are filed here, and how long the interest has been sitting.
  // `whole` is a unit a wrap may not split — a count, "Flexible", the date it
  // was asked on (K-462); where the diver is up to is a phrase ("Certified,
  // can share certification record", longer still in Spanish) and wraps like
  // one, or it would run out of a phone's column.
  const experienceFact = request.experienceLevel
    ? t(EXPERIENCE_KEYS[request.experienceLevel])
    : null;
  const facts = [
    request.partySize
      ? { text: t("requests.divers", { count: request.partySize }), whole: true }
      : null,
    experienceFact ? { text: experienceFact, whole: false } : null,
    request.dateFlexible ? { text: t("requests.flexible"), whole: true } : null,
    // When they asked is the desk's sorting fact; a phone reads who and what.
    {
      text: t("requests.askedOn", { date: formatShortDate(request.askedAt, locale, timezone) }),
      whole: true,
      desktop: true,
    },
  ].filter((fact): fact is { text: string; whole: boolean; desktop?: boolean } => fact !== null);

  // **The way back to whoever asked** (third UX review, item 13): an email
  // with the shop named in the subject, or the number they left when there is
  // no address. The inbox composer answers a diver's own message, and an interest
  // has none yet, so the door is the channel the diver gave.
  const replyHref = request.email
    ? `mailto:${request.email}?subject=${encodeURIComponent(t("requests.replySubject", { shopName }))}`
    : request.phone
      ? `tel:${request.phone.replace(/[^\d+]/g, "")}`
      : null;
  const actionLink = menuRowClass("quiet", { gutter: false });

  return (
    <LedgerRow
      as="li"
      pad="lg"
      // The booking link on the name's line, not centred on the whole request.
      align="first-line"
      // The "⋯" stays on the name's line at every width (visual review A23):
      // the request wraps beneath the name, the menu never drops a line.
      // `first-line` aligns on the baseline from `sm`; a phone takes the same.
      className="max-sm:items-baseline"
      trailing={
        <RowMenu label={t("requests.moreFor", { name })} panelClassName="w-60">
          <Link
            href={`${shopPath(shopSlug, "bookings", "new")}?request=${encodeURIComponent(request.id)}`}
            className={actionLink}
          >
            {t("requests.createBooking")}
          </Link>
          {replyHref ? (
            <a href={replyHref} className={actionLink}>
              {t("requests.reply")}
            </a>
          ) : null}
          <form action={markDoneAction}>
            <input type="hidden" name="requestId" value={request.id} />
            <input type="hidden" name="outcome" value="done" />
            <SubmitButton pendingLabel={t("requests.markDone")} className={actionLink}>
              {t("requests.markDone")}
            </SubmitButton>
          </form>
        </RowMenu>
      }
    >
      <div className="flex min-w-0 flex-col gap-1 sm:flex-row sm:items-baseline sm:gap-4">
        <p className="min-w-0 font-semibold sm:w-44 sm:shrink-0">
          {request.personId ? (
            <Link
              href={shopPath(shopSlug, "divers", request.personId)}
              className={`${NAME_TARGET} inline-flex max-w-full items-center gap-1 text-primary hover:underline`}
            >
              <span className="truncate">{name}</span>
              <DiveDayIcon name="chevron-right" className="size-4 shrink-0" />
            </Link>
          ) : (
            name
          )}
        </p>
        <div className="min-w-0 flex-1">
          <p className="font-medium">{ask}</p>
          <p className="mt-0.5 text-sm text-muted tabular-nums">
            {facts.map((fact, index) => (
              <span key={fact.text} className={fact.desktop ? "max-sm:hidden" : undefined}>
                {index > 0 ? SEPARATOR : null}
                <span className={fact.whole ? "whitespace-nowrap" : undefined}>{fact.text}</span>
              </span>
            ))}
          </p>
          {request.email || request.phone ? (
            <p className="mt-0.5 text-sm text-muted">
              {request.email ? (
                // **Underlined always, not on hover.** This link sits *inside*
                // a run of text — the diver's phone number beside it — where
                // colour alone is the only thing marking it as a link, and
                // `--primary` against the surrounding ink is 2.8:1, under
                // WCAG's 3:1 floor for exactly that (axe `link-in-text-block`,
                // found by the scan added in issue #1056). The booking link in
                // the row's trailing slot stands alone, so the rule does not
                // reach it and it keeps the hover underline.
                <a
                  href={`mailto:${request.email}`}
                  className={`${ADDRESS_TARGET} text-primary underline`}
                >
                  {request.email}
                </a>
              ) : null}
              {request.email && request.phone ? SEPARATOR : null}
              {/* A request's number is the diver's own typing, not a
                  normalised `people.phone`, so this mostly hands back exactly
                  what they wrote — it groups the one shape that would
                  otherwise arrive here as an unbroken run, a diver who typed
                  E.164 into the public form. One unbreakable run: it split
                  after its hyphens at 390 (K-462). */}
              {request.phone ? (
                <a
                  href={`tel:${request.phone.replace(/[^\d+]/g, "")}`}
                  className={`${ADDRESS_TARGET} whitespace-nowrap text-primary underline`}
                >
                  {displayStoredPhone(request.phone)}
                </a>
              ) : null}
            </p>
          ) : null}
          {request.timing ? (
            <p className="mt-1 text-sm text-muted">
              {t("requests.whenSuits", { timing: request.timing })}
            </p>
          ) : null}
          {request.message ? <p className="mt-1 text-sm text-pretty">{request.message}</p> : null}
          {openDeparture ? (
            <Link
              href={openDeparture.href}
              className={buttonClass({
                variant: "link",
                size: "sm",
                flush: true,
                className: "mt-2 print:hidden",
              })}
            >
              {openDeparture.label}
            </Link>
          ) : null}
        </div>
      </div>
    </LedgerRow>
  );
}
