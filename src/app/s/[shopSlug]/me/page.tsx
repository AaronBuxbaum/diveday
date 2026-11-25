import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { signOutDiverAction } from "@/app/actions/diver-sign-out";
import { ShopPageHeader } from "@/components/ShopPageHeader";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { SectionCard } from "@/components/ui/card";
import { controlClass, Field, FieldGrid, FormStatus } from "@/components/ui/form";
import { FIGURE_INLINE_CLASS } from "@/components/ui/typography";
import { getDb } from "@/db/client";
import { type DiverProfile, readDiverProfile } from "@/features/accounts/diver-profile";
import { currentDiver } from "@/features/accounts/diver-sign-in";
import { shopBySlugCached } from "@/features/platform/shops-cached";
import type { DiverTranslator } from "@/i18n/messages";
import { DIVER_CERT_LEVEL_KEYS } from "@/i18n/next-dive-labels";
import { DIVER_CERTIFICATION_AGENCY_KEYS, DIVER_SPECIALTY_KEYS } from "@/i18n/readiness-labels";
import { requestTranslator } from "@/i18n/request";
import { formatDateTimeTz, formatMoneyScanned, formatShortDate } from "@/lib/format";
import { toShopCurrency } from "@/lib/money";
import { publicSchedulePath, publicSignInPath, publicTripPath } from "@/lib/public-routes";
import { saveDiverContactAction } from "./actions";

export const instant = true;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ shopSlug: string }>;
}): Promise<Metadata> {
  const { shopSlug } = await params;
  const shop = await shopBySlugCached(shopSlug);
  const { t } = await requestTranslator(shop?.defaultLocale);
  return {
    title: shop ? `${t("profile.metaTitle")} — ${shop.name}` : t("profile.metaTitle"),
    robots: { index: false, follow: false },
  };
}

/**
 * **My profile** (ADR 20261125-diver-sign-in): what this shop holds about the
 * signed-in diver, read by the person their session names and nobody else.
 * Signed out, the page is the sign-in page.
 */
export default async function DiverProfilePage({
  params,
  searchParams,
}: {
  params: Promise<{ shopSlug: string }>;
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  const { shopSlug } = await params;
  const { saved, error } = await searchParams;
  const shop = await shopBySlugCached(shopSlug);
  if (!shop) notFound();
  const db = await getDb();
  const diver = await currentDiver(db, shop.id);
  if (!diver) redirect(publicSignInPath(shop.slug));
  const currency = toShopCurrency(shop.currency);
  const profile = await readDiverProfile(db, {
    shopId: shop.id,
    personId: diver.personId,
    currency,
  });
  if (!profile) redirect(publicSignInPath(shop.slug));
  const { locale, t } = await requestTranslator(shop.defaultLocale);
  const money = (cents: number) => formatMoneyScanned(cents, currency, locale);
  const day = (at: Date) => formatShortDate(at, locale, shop.timezone);
  const when = (at: Date) => formatDateTimeTz(at, locale, shop.timezone);
  const { person } = profile;

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-8 sm:px-6 sm:py-10">
      <ShopPageHeader
        title={person.fullName}
        description={t("profile.description", { shopName: shop.name })}
      />
      {profile.credit.balanceCents > 0 || profile.credit.entries.length > 0 ? (
        <SectionCard title={t("profile.creditHeading")}>
          <p className={FIGURE_INLINE_CLASS}>
            {t("profile.creditBalance", { amount: money(profile.credit.balanceCents) })}
          </p>
          <ul className="mt-2 space-y-1 text-sm text-muted">
            {profile.credit.entries.map((entry) => (
              <li key={entry.id} className="flex justify-between gap-4 tabular-nums">
                <span>{creditLine(t, entry.kind, day(entry.occurredAt))}</span>
                <span>
                  {entry.kind === "redeem" ? "−" : "+"}
                  {money(entry.amountCents)}
                </span>
              </li>
            ))}
          </ul>
        </SectionCard>
      ) : null}
      <SectionCard title={t("profile.upcomingHeading")}>
        {profile.upcoming.length === 0 ? (
          <div className="flex flex-col items-start gap-3">
            <p className="text-muted">{t("profile.upcomingNone")}</p>
            <Link
              href={publicSchedulePath(shop.slug)}
              className={buttonClass({ variant: "secondary", size: "sm" })}
            >
              {t("profile.seeSchedule")}
            </Link>
          </div>
        ) : (
          <TripList shopSlug={shop.slug} trips={profile.upcoming} when={when} />
        )}
      </SectionCard>
      {profile.past.length > 0 ? (
        <SectionCard title={t("profile.pastHeading")}>
          <TripList shopSlug={shop.slug} trips={profile.past} when={day} />
        </SectionCard>
      ) : null}
      <SectionCard title={t("profile.cardsHeading")}>
        {profile.cards.length === 0 ? (
          <p className="text-muted">{t("profile.cardsNone")}</p>
        ) : (
          <ul className="divide-y divide-border">
            {profile.cards.map((card) => (
              <li key={card.id} className="flex justify-between gap-4 py-2">
                <span>
                  {cardName(t, card)} · {t(DIVER_CERTIFICATION_AGENCY_KEYS[card.agency])}
                </span>
                <span className="text-sm text-muted">
                  {t(card.verified ? "profile.cardVerified" : "profile.cardPending")}
                </span>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>
      <SectionCard id="details" title={t("profile.detailsHeading")} className="scroll-mt-4">
        <form action={saveDiverContactAction.bind(null, shop.slug)} className="flex flex-col gap-4">
          {saved ? <FormStatus tone="success">{t("profile.saved")}</FormStatus> : null}
          {error ? <FormStatus tone="danger">{t("profile.emergencyPair")}</FormStatus> : null}
          <Field label={t("diverSignIn.email")} description={t("profile.emailHint")}>
            <input
              value={person.email ?? ""}
              readOnly
              type="email"
              className={`${controlClass} bg-surface-sunken/60`}
            />
          </Field>
          <FieldGrid columns={1} className="gap-y-4">
            <Field label={t("profile.phone")} hint={t("common.optional")}>
              <input
                name="phone"
                type="tel"
                autoComplete="tel"
                maxLength={40}
                defaultValue={person.phone ?? ""}
                className={controlClass}
              />
            </Field>
          </FieldGrid>
          <FieldGrid className="gap-y-4">
            <Field label={t("profile.emergencyName")} hint={t("common.optional")}>
              <input
                name="emergencyContactName"
                maxLength={120}
                defaultValue={person.emergencyContactName ?? ""}
                className={controlClass}
              />
            </Field>
            <Field label={t("profile.emergencyPhone")} hint={t("common.optional")}>
              <input
                name="emergencyContactPhone"
                type="tel"
                maxLength={40}
                defaultValue={person.emergencyContactPhone ?? ""}
                className={controlClass}
              />
            </Field>
          </FieldGrid>
          <SubmitButton pendingLabel={t("words.busy.saving")} className={buttonClass()}>
            {t("profile.save")}
          </SubmitButton>
        </form>
      </SectionCard>
      <form action={signOutDiverAction.bind(null, shop.slug)}>
        <SubmitButton
          pendingLabel={t("profile.signOut")}
          className={buttonClass({ variant: "secondary", size: "sm" })}
        >
          {t("profile.signOut")}
        </SubmitButton>
      </form>
    </main>
  );
}

function TripList({
  shopSlug,
  trips,
  when,
}: {
  shopSlug: string;
  trips: DiverProfile["upcoming"];
  when: (at: Date) => string;
}) {
  return (
    <ul className="divide-y divide-border">
      {trips.map((trip) => (
        <li key={trip.bookingId} className="py-2">
          <Link
            href={publicTripPath(shopSlug, trip.tripId)}
            className="flex min-h-11 flex-col justify-center hover:underline sm:flex-row sm:items-center sm:justify-between sm:gap-4"
          >
            <span className="font-medium">{trip.title}</span>
            <span className="text-sm text-muted">{when(trip.startsAt)}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

function creditLine(t: DiverTranslator, kind: string, date: string) {
  if (kind === "redeem") return t("profile.creditSpent", { date });
  if (kind === "restore") return t("profile.creditReturned", { date });
  return t("profile.creditGranted", { date });
}

function cardName(t: DiverTranslator, card: DiverProfile["cards"][number]) {
  if (card.kind === "level" && card.level) return t(DIVER_CERT_LEVEL_KEYS[card.level]);
  if (card.kind === "specialty" && card.specialty) return t(DIVER_SPECIALTY_KEYS[card.specialty]);
  return t("profile.nitroxCard");
}
