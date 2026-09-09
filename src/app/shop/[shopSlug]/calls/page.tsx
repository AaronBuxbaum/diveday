import type { Metadata } from "next";
import { connection } from "next/server";
import { discardFormDraftAction, saveFormDraftAction } from "@/app/actions/form-drafts";
import { FormDraft } from "@/components/FormDraft";
import { formDraftCopy } from "@/components/form-draft-copy";
import { ShopPageHeader } from "@/components/ShopPageHeader";
import { SubmitButton } from "@/components/SubmitButton";
import { PersonFieldTrio } from "@/components/seat-diver/PersonFieldTrio";
import { buttonClass } from "@/components/ui/button";
import { SectionCard } from "@/components/ui/card";
import { FieldActions, FormStatus } from "@/components/ui/form";
import { readFormDraft } from "@/db/form-drafts";
import { offsetUpcomingTripsWithCounts } from "@/db/trips";
import { requestLocale } from "@/i18n/request";
import { type StaffMessageKey, staffTranslator } from "@/i18n/staff-messages";
import { formatShortDate, formatTime } from "@/lib/format";
import { requireShopSurface } from "@/lib/session";
import { type NoticeTone, noticeFromParam } from "@/lib/staff-notices";
import { isCallOutcome } from "@/lib/took-a-call";
import { spotsRemaining } from "@/lib/trips";
import { type CallDeparture, TookACallFields } from "./_components/TookACallFields";
import { tookACallAction } from "./actions";

// `instant = true`: this segment's `loading.tsx` is the boundary, and the form
// paints before the departures read. See ADR 20260804-instant-navigation.
export const instant = true;

export const metadata: Metadata = {
  title: "Took a call — DiveDay",
  // Staff-only operations surface, never a public document.
  robots: { index: false, follow: false },
};

/**
 * How many departures the picker offers. A phone call is about the next week or
 * two; a caller asking about August is asking for a day that is not on the
 * board yet, which is the first of the three options rather than a longer list.
 * Bounded here for the same reason the add-booking picker is bounded — a busy
 * season has hundreds of upcoming departures and a `<select>` holding all of
 * them is a control nobody can use one-handed with a handset to their ear.
 */
const DEPARTURE_CHOICES = 40;

/**
 * The refusals this form can see for itself, before any of the three writers it
 * delegates to has run (`./actions.ts`). Everything downstream — a boat that
 * filled, a diver already aboard, a wait list on a departure that turns out to
 * have a seat — is refused on the door that owns it, in that door's own words.
 */
const NOTICES: Record<string, { tone: NoticeTone; key: StaffMessageKey }> = {
  "call-invalid": { tone: "danger", key: "calls.notice.invalid" },
  "call-name": { tone: "danger", key: "calls.notice.name" },
  "call-reply": { tone: "danger", key: "calls.notice.reply" },
  "call-email": { tone: "danger", key: "calls.notice.email" },
  "call-departure": { tone: "danger", key: "calls.notice.departure" },
  "call-interest": { tone: "danger", key: "calls.notice.interest" },
};

/**
 * **"Took a call"** (N-22): the desk phone's one door.
 *
 * A staffer with a caller on the line is holding one conversation, and the app
 * used to make them decide which of three objects it was about *before* they
 * could write any of it down — leave the page, find the wait list or the
 * requests page or a departure, and start typing while the caller waited. This
 * takes the caller once and asks where it lands as the last question.
 *
 * What each answer becomes is unchanged and is not re-implemented here: a date
 * request is a `course_inquiries` row (ADR
 * 20260814-a-date-request-is-a-course-inquiry), a wait-list entry goes through
 * the trip page's own writer, and a booking goes through the shared
 * seat-a-diver door so the waiver, the trail and the analytics event cannot be
 * skipped by one surface.
 *
 * The form keeps a draft as it is typed (ADR 20260906-before-you-ask, decision
 * 3), which is what a call interrupted mid-sentence needs more than any other
 * form in the app: the second call comes in, the page is left, and what the
 * first caller said is still here.
 */
export default async function TookACallPage({
  params,
  searchParams,
}: {
  params: Promise<{ shopSlug: string }>;
  searchParams: Promise<{ notice?: string; outcome?: string }>;
}) {
  await connection(); // live seat counts — render per request, never a build-time shell
  const { shopSlug } = await params;
  const { notice, outcome } = await searchParams;
  const { db, shop, session } = await requireShopSurface(shopSlug);
  const locale = await requestLocale(shop.defaultLocale);
  const t = staffTranslator(locale);

  const [draft, tripPage] = await Promise.all([
    readFormDraft(db, shop.id, session.user.personId, "took_a_call"),
    offsetUpcomingTripsWithCounts(db, shop.id, { limit: DEPARTURE_CHOICES }),
  ]);

  /**
   * Every upcoming departure, full ones included: the wait list is *only* for a
   * full boat, so filtering them out would hide exactly the departures one of
   * the three answers exists for. Each option says which it is, so the staffer
   * picks the right pair rather than meeting a refusal after the caller has
   * hung up.
   */
  const departures: CallDeparture[] = tripPage.trips.map((trip) => {
    const seats = spotsRemaining(trip);
    const shape = {
      title: trip.title,
      date: formatShortDate(trip.startsAt, locale, shop.timezone),
      time: formatTime(trip.startsAt, locale, shop.timezone),
    };
    return {
      id: trip.id,
      label:
        seats > 0 ? t("calls.departureOpen", { ...shape, seats }) : t("calls.departureFull", shape),
    };
  });

  const banner = noticeFromParam(notice, NOTICES);

  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-8 sm:px-6 sm:py-10">
      <ShopPageHeader eyebrow={t("calls.eyebrow")} title={t("calls.title")} />
      <SectionCard className="mt-8" padding="lg" title={t("calls.callerHeading")}>
        <form action={tookACallAction.bind(null, shopSlug)}>
          <FormDraft
            form="took_a_call"
            draft={
              draft
                ? {
                    fields: draft.fields,
                    savedAtLabel: formatTime(draft.savedAt, locale, shop.timezone),
                  }
                : null
            }
            actions={{ save: saveFormDraftAction, discard: discardFormDraftAction }}
            copy={formDraftCopy(t)}
          />
          <PersonFieldTrio
            as="div"
            email="optional"
            nameLabel={t("seatDiver.nameLabel")}
            emailLabel={t("seatDiver.emailLabel")}
            phoneLabel={t("seatDiver.phoneLabel")}
            optionalHint={t("seatDiver.optionalHint")}
          />
          <TookACallFields
            copy={{
              outcomeHeading: t("calls.outcomeHeading"),
              outcome: {
                "date-request": t("calls.outcome.dateRequest"),
                waitlist: t("calls.outcome.waitlist"),
                booking: t("calls.outcome.booking"),
              },
              departureLabel: t("calls.departureLabel"),
              departureUnchosen: t("calls.departureUnchosen"),
              noDepartures: t("calls.noDepartures"),
              interestLabel: t("calls.interestLabel"),
              interestPlaceholder: t("calls.interestPlaceholder"),
              preferredDateLabel: t("calls.preferredDateLabel"),
              diversLabel: t("calls.diversLabel"),
              noteLabel: t("calls.noteLabel"),
              optionalHint: t("seatDiver.optionalHint"),
            }}
            departures={departures}
            defaultOutcome={isCallOutcome(outcome) ? outcome : null}
          />
          {/* The refusal sits in the action row beside the button that produced
              it, never in a banner at the top of the page — this page has one
              form, and the rule is the same either way
              (docs/design/forms-and-controls.md). */}
          <FieldActions className="mt-6">
            <SubmitButton pendingLabel={t("calls.submitting")} className={buttonClass()}>
              {t("calls.submit")}
            </SubmitButton>
            <FormStatus tone={banner?.tone ?? "danger"}>{banner ? t(banner.key) : null}</FormStatus>
          </FieldActions>
        </form>
      </SectionCard>
    </main>
  );
}
