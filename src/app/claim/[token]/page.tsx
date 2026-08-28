import type { Metadata } from "next";
import { connection } from "next/server";
import { EntryDone } from "@/components/account/EntryShell";
import { ExpiredLinkCard } from "@/components/ExpiredLinkCard";
import { FlashParams } from "@/components/FlashParams";
import { ShopNotice } from "@/components/ShopPageHeader";
import { SubmitButton } from "@/components/SubmitButton";
import { ThreadShell } from "@/components/thread/ThreadShell";
import { buttonClass } from "@/components/ui/button";
import { SectionCard } from "@/components/ui/card";
import { controlClass, Field } from "@/components/ui/form";
import { getDb } from "@/db/client";
import { getTripRequirements, getTripSiteRequirement } from "@/db/readiness";
import { type DeadClaimShop, getClaimPageState } from "@/db/seat-claims";
import { type DiverMessageKey, type DiverTranslator, diverTranslator } from "@/i18n/messages";
import { tripRequirementList } from "@/i18n/readiness-labels";
import { requestLocale } from "@/i18n/request";
import { formatShortDate, formatTimeRangeTz } from "@/lib/format";
import { combineCertRequirements } from "@/lib/readiness";
import { noticeFromParam, noticeRole } from "@/lib/staff-notices";
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
  "error-already": { tone: "danger", key: "seatClaim.errors.alreadyBooked" },
  "error-course": { tone: "danger", key: "seatClaim.errors.coursePrerequisite" },
  "error-rate": { tone: "danger", key: "ready.rateLimited" },
};

/**
 * **The dead claim link, in the booking tier** (ADR 20260827-first-light,
 * decisions 3 and 4).
 *
 * A dead link is the whole page — the terminal warm pattern, no card border
 * (docs/design/principles.md #4) — and this is the half of it that knows which
 * shop the link belonged to. A party member was forwarded this URL in a group
 * chat and it does not work; the one thing they need is who to ask, so the card
 * names the shop and hands over the contact details that shop already
 * publishes.
 *
 * **One sentence serves every cause, so it may claim nothing about the seat.**
 * `getClaimPageState` deliberately cannot tell those causes apart — a dead
 * token is read for its shop and for nothing else — so whatever this says is
 * said equally to a spent link, an expired one, a seat somebody else took, a
 * seat the shop cancelled, a departure called off for weather, and a boat that
 * has already sailed. It used to say "your seat is safe with your organizer —
 * ask them for a fresh link", which is untrue for four of those six and mints
 * nothing for five: `issuePartySeatClaims` hands back `claim: null` the moment
 * a seat can no longer change hands, so the organizer's panel has no link left
 * to forward. The sharpest of them is weather: a diver whose Saturday had been
 * called off read that their seat still existed and could reasonably turn up at
 * the dock. The sentence now names the one person this page cannot — whoever
 * sent the link — and asserts nothing it has not read.
 *
 * There is deliberately no way onward and no self-serve rescue: unlike
 * `/ready`, a fresh claim link can only be minted from the organizer's own
 * party panel, and this page has no idea who that is.
 */
function DeadClaim({ shop, t }: { shop: DeadClaimShop; t: DiverTranslator }) {
  return (
    <ExpiredLinkCard
      title={t("seatClaim.unavailableHeading")}
      text={t("seatClaim.expiredBody")}
      shop={shop}
      t={t}
    />
  );
}

/**
 * **The other tier: a token that resolves to nothing at all.**
 *
 * No record, so no shop — naming one would mean guessing, and a bearer token
 * reveals only its own record. The heading is the same sentence the tier above
 * opens with; what it cannot do is offer a hand.
 */
function Unavailable({ t }: { t: DiverTranslator }) {
  return (
    <EntryDone
      glyph="expired"
      title={t("seatClaim.unavailableHeading")}
      text={t("seatClaim.unavailableBody")}
    />
  );
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
 * success lands on `/ready/<token>`, which is the same thread's next page. The
 * hand-rolled `max-w-xl` column and `TokenPageHeader` this used to spell for
 * itself are gone; the measure is the shell's
 * (ADR 20260827-the-divers-thread, decision 1).
 *
 * The two dead-link tiers above are the part worth reading before editing.
 */
export default async function SeatClaimPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  await connection();
  const { token } = await params;
  const { error } = await searchParams;
  const db = await getDb();
  // Three answers, and which one a dead link gets is the security question on
  // this page (ADR 20260827-first-light, decision 3): `dead` still knows the
  // shop and hands over its published contact, `unknown` knows nothing and
  // says nothing. `getClaimPageState` owns that split so no branch here can
  // widen it.
  const state = await getClaimPageState(db, token);
  if (state.kind === "unknown") {
    // Nothing resolved, so nothing to negotiate a language against but the
    // visitor's own device.
    return <Unavailable t={diverTranslator(await requestLocale())} />;
  }
  if (state.kind === "dead") {
    return (
      <DeadClaim
        shop={state.shop}
        t={diverTranslator(await requestLocale(state.shop.defaultLocale))}
      />
    );
  }
  const data = state.data;
  const locale = await requestLocale(data.defaultLocale);
  const t = diverTranslator(locale);

  const notice = noticeFromParam(error ? `error-${error}` : undefined, CLAIM_NOTICES);
  // The trip's own cert gate refused the claim: state what the *trip*
  // requires — the same trip-property sentence the booking form uses, saying
  // nothing about any person's record (H-22).
  let requirementNotice: string | null = null;
  if (error === "requirement") {
    const [requirement, siteRequirement] = await Promise.all([
      getTripRequirements(db, data.shopId, data.tripId),
      getTripSiteRequirement(db, data.shopId, data.tripId),
    ]);
    const list = tripRequirementList(
      t,
      combineCertRequirements(
        requirement ?? {
          minimumCertificationLevel: null,
          requiredSpecialties: [],
          requiresNitrox: false,
        },
        siteRequirement,
      ),
      locale,
    );
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
          <Field label={`${t("seatClaim.phoneLabel")} ${t("common.optional")}`}>
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
              className={buttonClass({ size: "lg", className: "disabled:opacity-70" })}
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
