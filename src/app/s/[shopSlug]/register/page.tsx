import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { ShopPageHeader } from "@/components/ShopPageHeader";
import { getDb } from "@/db/client";
import { getShopBySlug } from "@/db/shops";
import { DiverIntlProvider } from "@/i18n/DiverIntlProvider";
import { requestLocale, requestTranslator } from "@/i18n/request";
import { publicShopRegisterPath } from "@/lib/public-routes";
import { registerAtShopAction } from "./actions";
import { RegisterForm } from "./RegisterForm";

export const instant = true;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ shopSlug: string }>;
}): Promise<Metadata> {
  const { shopSlug } = await params;
  const shop = await getShopBySlug(await getDb(), shopSlug);
  if (!shop) return { title: "Register — DiveDay" };
  const { t } = await requestTranslator(shop.defaultLocale);
  return {
    title: `${t("register.title", { shop: shop.name })} — ${shop.name}`,
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
  const shop = await getShopBySlug(await getDb(), shopSlug);
  if (!shop) notFound();
  const locale = await requestLocale(shop.defaultLocale);
  const { t } = await requestTranslator(shop.defaultLocale);

  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <ShopPageHeader
        title={t("register.title", { shop: shop.name })}
        description={t("register.intro")}
      />
      {/* Without a provider above it the whole page degrades to a blank
          client-only 200 (src/i18n/provider-coverage.test.ts). */}
      <DiverIntlProvider
        locale={locale}
        timeZone={shop.timezone}
        namespaces={["register", "common", "course"]}
      >
        <RegisterForm action={registerAtShopAction.bind(null, shop.slug)} shopName={shop.name} />
      </DiverIntlProvider>
    </main>
  );
}
