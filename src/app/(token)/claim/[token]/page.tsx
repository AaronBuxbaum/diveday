import type { Metadata } from "next";
import { connection } from "next/server";
import { EntryDone } from "@/components/account/EntryShell";
import { DeadLink } from "@/components/DeadLink";
import { FlashParams } from "@/components/FlashParams";
import { SmsConsentNote } from "@/components/SmsConsentNote";
import { SubmitButton } from "@/components/SubmitButton";
import { ThreadShell } from "@/components/thread/ThreadShell";
import { buttonClass } from "@/components/ui/button";
import { SectionCard } from "@/components/ui/card";
import { controlClass, Field } from "@/components/ui/form";
import { ShopNotice } from "@/components/ui/outcome";
import { noticeRole } from "@/components/ui/tone";
import { getDb } from "@/db/client";
import { getTripRequirements, getTripSiteRequirement } from "@/db/readiness";
import { type DeadClaimCause, type DeadClaimShop, getClaimPageState } from "@/features/seat-claims";
import { type DiverMessageKey, type DiverTranslator, diverTranslator } from "@/i18n/messages";
import { tripRequirementList } from "@/i18n/readiness-labels";
import { requestLocale } from "@/i18n/request";
import { formatShortDate, formatTimeRangeTz } from "@/lib/format";
import { unionRequirements } from "@/lib/requirement";
import { noticeFromParam } from "@/lib/staff-notices";
import { claimSeatAction } from "./actions";

export async function generateMetadata(): Promise<Metadata> {
  const t = diverTranslator(await requestLocale());
  return {
    title: t("seatClaim.metaTitle"),
    robots: { index: false, follow: false },
  };
}

/**
 * Notice keys, not sentences (docs ADR 20260729-diver-copy-localization).
 * `requirement` is resolved separately below — its sentence needs the trip's
 * own requirement list interpolated.
 */
const CLAIM_NOTICES: Record<string, { tone: "danger" | "neutral"; key: DiverMessageKey }> = {
  "error-fields": { tone: "danger", key: "seatClaim.errors.checkFields" },
  "error-course": { tone: "danger", key: "seatClaim.errors.coursePrerequisite" },
  "error-held": { tone: "danger", key: "seatClaim.errors.alreadyHeld" },
  "error-rate": { tone: "danger", key: "ready.rateLimited" },
};

/** What happened to the seat, in the dead card's one line under the shop. */
const DEAD_CLAIM_BODY: Record<DeadClaimCause, DiverMessageKey> = {
  trip_cancelled: "seatClaim.tripCancelledBody",
  seat_cancelled: "seatClaim.seatCancelledBody",
  claimed: "seatClaim.claimedBody",
  departed: "seatClaim.departedBody",
  ended: "seatClaim.expiredBody",
};

/**
 * **The dead claim link, in the booking tier** (ADR 20260827-first-light,
 * decisions 3 and 4): the whole page, naming the shop the link belonged to
 * with the contact details that shop already publishes, and saying what
 * happened to the seat. A fresh claim link can only come from the organizer's
 * own party panel, so there is no self-serve rescue here.
 */
function DeadClaim({
  shop,
  cause,
  t,
}: {
  shop: DeadClaimShop;
  cause: DeadClaimCause;
  t: DiverTranslator;
}) {
  return <DeadLink t={t} next={t(DEAD_CLAIM_BODY[cause])} shop={shop} />;
}

/**
 * **The other tier: a token that resolves to nothing at all.**
 *
 * No record, so no shop — naming one would mean guessing, and a bearer token
 * reveals only its own record. The heading is the same sentence the tier above
 * opens with; what it cannot do is offer a hand.
 */
function Unavailable({ t }: { t: DiverTranslator }) {
  return <DeadLink t={t} next={t("seatClaim.unavailableBody")} diveDayDoor={false} />;
}

// `instant = true`: this route has a real static shell. Every request-scoped
// read below (the token lookup, `requestLocale()`) sits inside this segment's
// `loading.tsx` boundary, so the frame paints without waiting on the request
// and the data streams into it. The URL is still the capability
// (docs/engineering/capability-telemetry-runbook.md); nothing here is
// cacheable or shared between bearers. See ADR 20260804-instant-navigation.
export const instant = true;

/**
 * **`/claim/[token]` — the thread's first page for a party member** (ADR
 * 20260827-first-light, decision 4: claim joins the thread).
 *
 * A claim is not a door into DiveDay. Nobody arrives here to sign up for
 * anything: an organizer booked several seats and forwarded one link per seat,
 * and the person opening it is already booked on a boat they have not been
 * told they are on. So the page wears `ThreadShell` — the shop as the eyebrow,
 * the trip as the title, DiveDay's name nowhere on it (decision 5) — and its
 * success lands back here, saying the seat is theirs and that their prep is in
 * the email on its way. The hand-rolled `max-w-xl` column and
 * `TokenPageHeader` this used to spell for itself are gone; the measure is the
 * shell's
 * (ADR 20260827-the-divers-thread, decision 1).
 *
 * The two dead-link tiers above are the part worth reading before editing.
 */
export default async function SeatClaimPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ error?: string; claimed?: string }>;
}) {
  await connection();
  const { token } = await params;
  const { error, claimed } = await searchParams;
  const db = await getDb();
  // Three answers (ADR 20260827-first-light, decision 3): `dead` knows the
  // shop and what happened to the seat, `unknown` knows nothing and says
  // nothing. `getClaimPageState` owns that split so no branch here can widen
  // it.
  const state = await getClaimPageState(db, token);
  if (state.kind === "unknown") {
    // Nothing resolved, so nothing to negotiate a language against but the
    // visitor's own device.
    return <Unavailable t={diverTranslator(await requestLocale())} />;
  }
  if (state.kind === "dead") {
    const t = diverTranslator(await requestLocale(state.shop.defaultLocale));
    // Where a claim that worked lands: the seat now reads as claimed.
    if (claimed === "1" && state.cause === "claimed") {
      return (
        <EntryDone
          glyph="done"
          title={t("seatClaim.claimedHeading")}
          text={t("seatClaim.claimedNotice")}
        />
      );
    }
    return <DeadClaim shop={state.shop} cause={state.cause} t={t} />;
  }
  const data = state.data;
  const locale = await requestLocale(data.defaultLocale);
  const t = diverTranslator(locale);

  const notice = noticeFromParam(error ? `error-${error}` : undefined, CLAIM_NOTICES);
  // The trip's own cert gate refused the claim: state what the *trip*
  // requires — the same trip-property sentence the booking form uses, saying
  // nothing about any person's record (H-20260724-minimum-age-gate-fail).
  let requirementNotice: string | null = null;
  if (error === "requirement") {
    const [requirement, siteRequirement] = await Promise.all([
      getTripRequirements(db, data.shopId, data.tripId),
      getTripSiteRequirement(db, data.shopId, data.tripId),
    ]);
    const list = tripRequirementList(t, unionRequirements(requirement, siteRequirement), locale);
    if (list) {
      requirementNotice = data.contactEmail
        ? t("booking.errors.tripRequirementWithContact", { list, contact: data.contactEmail })
        : t("booking.errors.tripRequirement", { list });
    }
  }

  const when = formatShortDate(data.startsAt, locale, data.timezone);
  const timeRange = formatTimeRangeTz(data.startsAt, data.endsAt, locale, data.timezone);

  return (
    <ThreadShell
      shopName={data.shopName}
      title={t("seatClaim.heading", { trip: data.tripTitle })}
      meta={
        <p className="mt-1 text-base text-muted">
          {t("seatClaim.when", { date: when, time: timeRange })}
        </p>
      }
    >
      <FlashParams params={["error"]} />

      {notice ? (
        <div className="mt-6">
          <ShopNotice tone={notice.tone} role={noticeRole(notice.tone)}>
            {t(notice.key)}
          </ShopNotice>
        </div>
      ) : null}
      {requirementNotice ? (
        <div className="mt-6">
          <ShopNotice tone="danger" role={noticeRole("danger")}>
            {requirementNotice}
          </ShopNotice>
        </div>
      ) : null}

      {/* The thread's terminal card — the one `SectionCard padding="lg"` a
          diver works inside, the same panel `/waivers` signs in (ADR
          20260827-the-divers-thread, decision 1). */}
      <SectionCard padding="lg" className="mt-8">
        <p className="text-base text-muted">
          {t("seatClaim.body", {
            shop: data.shopName,
            seatName: data.seatName,
          })}
        </p>
        {/* A seat booked "Under 18" (H-20261014-parent-signs-minor-release): a parent or guardian signs with
            them, and, only where that door exists, the parent who booked can
            do it from their own page. */}
        {data.minorDeclared ? (
          <p className="mt-3 text-base text-muted">
            {t("seatClaim.minorNote", { seatName: data.seatName })}
            {data.parentCanSign ? ` ${t("seatClaim.minorNoteParentSigns")}` : null}
          </p>
        ) : null}
        <form action={claimSeatAction.bind(null, token)} className="mt-5 flex flex-col gap-4">
          <Field label={t("seatClaim.nameLabel")}>
            <input
              name="fullName"
              required
              maxLength={120}
              autoComplete="name"
              className={controlClass}
            />
          </Field>
          <Field label={t("seatClaim.emailLabel")}>
            <input
              name="email"
              type="email"
              required
              maxLength={200}
              autoComplete="email"
              className={controlClass}
            />
          </Field>
          <Field
            label={`${t("seatClaim.phoneLabel")} ${t("common.optional")}`}
            description={<SmsConsentNote t={t} />}
          >
            <input
              name="phone"
              type="tel"
              inputMode="tel"
              maxLength={30}
              autoComplete="tel"
              className={controlClass}
            />
          </Field>
          <div>
            <SubmitButton
              pendingLabel={t("seatClaim.claiming")}
              className={buttonClass({ className: "disabled:opacity-70" })}
            >
              {t("seatClaim.submit")}
            </SubmitButton>
          </div>
        </form>
        <p className="mt-4 text-sm text-muted">{t("seatClaim.privacyNote")}</p>
      </SectionCard>
    </ThreadShell>
  );
}
