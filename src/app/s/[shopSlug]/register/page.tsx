import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { ShopPageHeader } from "@/components/ShopPageHeader";
import { tapTargetLinkClass } from "@/components/ui/button";
import { assistsAvailable } from "@/db/assists";
import { getDb } from "@/db/client";
import { shopBySlugCached } from "@/db/shops-cached";
import { DiverIntlProvider } from "@/i18n/DiverIntlProvider";
import { requestLocale, requestTranslator } from "@/i18n/request";
import { mailtoHref, telHref } from "@/lib/contact-links";
import { publicShopRegisterPath } from "@/lib/public-routes";
import { registerAtShopAction } from "./actions";
import { readCardPhotoAtShopAction } from "./card-photo-action";
import { RegisterForm } from "./RegisterForm";

export const instant = true;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ shopSlug: string }>;
}): Promise<Metadata> {
  const { shopSlug } = await params;
  const shop = await shopBySlugCached(shopSlug);
  if (!shop) return { title: "Register — DiveDay" };
  const { t } = await requestTranslator(shop.defaultLocale);
  return {
    title: shop.selfRegistrationEnabled
      ? `${t("register.title", { shop: shop.name })} — ${shop.name}`
      : shop.name,
    alternates: { canonical: publicShopRegisterPath(shop.slug) },
    // **Never indexed.** This is a form the shop points its own visitors at
    // with a printed QR, not a page a search engine should be offering to
    // strangers — and a public write boundary is not something to advertise.
    robots: { index: false, follow: false },
  };
}

/**
 * **The counter's door: a diver goes on file before any booking exists**
 * (issue #1236).
 *
 * Twelve of the 32 products surveyed on 2026-09-01 sell QR or tablet self
 * check-in, and DiveDay's waiver only ever arrived on a link a staffer issued —
 * so a walk-in who had not booked had no way in at all. The shop prints this
 * page's QR from Settings and puts it on the counter.
 *
 * There is no diver account here and no second waiver flow: the form writes a
 * person, a self-declared card and a set of sizes, and the shop's ordinary
 * person-scoped waiver goes out to the contact they gave. Sign-once holds — a
 * diver whose release still stands gets no second link.
 *
 * The page is `noindex` and its ending is the same sentence for everybody; the
 * reason is the enumeration rule in `src/lib/self-registration.ts`.
 */
export default async function RegisterPage({ params }: { params: Promise<{ shopSlug: string }> }) {
  const { shopSlug } = await params;
  const shop = await shopBySlugCached(shopSlug);
  if (!shop) notFound();
  // Counter sign-up switched off on Features. A printed counter card can still
  // be taped up, so its QR lands on a page that sends the diver to the crew
  // rather than on a 404. No form, and nothing the shopfront footer does not
  // already show: the shop's name, phone and email.
  if (!shop.selfRegistrationEnabled) {
    const { t } = await requestTranslator(shop.defaultLocale);
    return (
      <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-8 sm:px-6 sm:py-10 [&_h1]:wrap-anywhere">
        <ShopPageHeader title={shop.name} description={t("register.switchedOff")} />
        {shop.contactPhone || shop.contactEmail ? (
          <p className="mt-4 flex flex-wrap gap-x-4">
            {shop.contactPhone ? (
              <a href={telHref(shop.contactPhone)} className={`${tapTargetLinkClass} underline`}>
                {shop.contactPhone}
              </a>
            ) : null}
            {shop.contactEmail ? (
              <a href={mailtoHref(shop.contactEmail)} className={`${tapTargetLinkClass} underline`}>
                {shop.contactEmail}
              </a>
            ) : null}
          </p>
        ) : null}
      </main>
    );
  }
  const locale = await requestLocale(shop.defaultLocale);
  const { t } = await requestTranslator(shop.defaultLocale);
  const canAssist = await assistsAvailable(await getDb(), shop.id);

  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-8 sm:px-6 sm:py-10 [&_h1]:wrap-anywhere">
      <ShopPageHeader
        title={t("register.title", { shop: shop.name })}
        description={t("register.intro")}
      />
      {/* Without a provider above it the whole page degrades to a blank
          client-only 200 (scripts/check-intl-providers.mjs). */}
      <DiverIntlProvider
        locale={locale}
        timeZone={shop.timezone}
        namespaces={["register", "common", "course"]}
      >
        <RegisterForm
          action={registerAtShopAction.bind(null, shop.slug)}
          shopName={shop.name}
          readCardPhoto={canAssist ? readCardPhotoAtShopAction.bind(null, shop.slug) : undefined}
        />
      </DiverIntlProvider>
    </main>
  );
}
