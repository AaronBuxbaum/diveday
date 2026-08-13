import type { Metadata } from "next";
import { connection } from "next/server";
import { EntryDone } from "@/components/account/EntryShell";
import { FlashParams } from "@/components/FlashParams";
import { ShopNotice } from "@/components/ShopPageHeader";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { controlClass, Field } from "@/components/ui/form";
import { getDb } from "@/db/client";
import { getTripRequirements, getTripSiteRequirement } from "@/db/readiness";
import { getClaimPageData } from "@/db/seat-claims";
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

function Unavailable({ t }: { t: DiverTranslator }) {
  return (
    <main className="mx-auto w-full max-w-xl flex-1 px-6 py-16">
      <section className="rounded-2xl border border-border bg-surface p-7 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">
          {t("seatClaim.unavailableHeading")}
        </h1>
        <p className="mt-3 text-muted">{t("seatClaim.unavailableBody")}</p>
      </section>
    </main>
  );
}

// `instant = true`: this route has a real static shell. Every request-scoped
// read below (the token lookup, `requestLocale()`) sits inside this segment's
// `loading.tsx` boundary, so the frame paints without waiting on the request
// and the data streams into it. The URL is still the capability
// (docs/engineering/capability-telemetry-runbook.md); nothing here is
// cacheable or shared between bearers. See ADR 20260804-instant-navigation.
export const instant = true;

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
  // A dead link resolves no shop, so negotiate from the visitor's device
  // alone for that branch, then re-negotiate once the shop is known.
  const data = await getClaimPageData(db, token);
  if (!data) {
    return <Unavailable t={diverTranslator(await requestLocale())} />;
  }
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
    <main className="mx-auto w-full max-w-xl flex-1 px-6 py-10 sm:py-16">
      <FlashParams params={["error"]} />
      <header>
        <p className="text-sm font-medium tracking-widest text-primary uppercase">
          {t("seatClaim.eyebrow")}
        </p>
        <p className="text-sm font-medium tracking-widest text-primary uppercase">
          {data.shopName}
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-balance">
          {t("seatClaim.heading", { trip: data.tripTitle })}
        </h1>
        <p className="mt-1 text-base text-muted">
          {t("seatClaim.when", { date: when, time: timeRange })}
        </p>
      </header>

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

      <section className="mt-8 rounded-2xl border border-border bg-surface p-5 sm:p-6">
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
      </section>
    </main>
  );
}
