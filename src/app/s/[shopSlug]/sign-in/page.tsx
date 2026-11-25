import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ShopPageHeader } from "@/components/ShopPageHeader";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { SectionCard } from "@/components/ui/card";
import { controlClass, Field, FormStatus } from "@/components/ui/form";
import { getDb } from "@/db/client";
import { currentDiver } from "@/features/accounts/diver-sign-in";
import { shopBySlugCached } from "@/features/platform/shops-cached";
import { requestTranslator } from "@/i18n/request";
import { publicProfilePath, publicSignInPath } from "@/lib/public-routes";
import { requestDiverSignIn } from "./actions";

// `instant = true`: every request read sits under this segment's `loading.tsx`
// (ADR 20260804-instant-navigation).
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
    title: shop ? `${t("diverSignIn.metaTitle")} — ${shop.name}` : t("diverSignIn.metaTitle"),
    robots: { index: false, follow: false },
  };
}

/**
 * A diver signs in to this shop's pages with an emailed link (ADR
 * 20261125-diver-sign-in). One field; the answer after it is the same whether
 * the shop holds that address or not.
 */
export default async function DiverSignInPage({
  params,
  searchParams,
}: {
  params: Promise<{ shopSlug: string }>;
  searchParams: Promise<{ sent?: string; error?: string }>;
}) {
  const { shopSlug } = await params;
  const { sent, error } = await searchParams;
  const shop = await shopBySlugCached(shopSlug);
  if (!shop) notFound();
  if (await currentDiver(await getDb(), shop.id)) redirect(publicProfilePath(shop.slug));
  const { t } = await requestTranslator(shop.defaultLocale);

  return (
    <main className="mx-auto w-full max-w-xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      {sent ? (
        <>
          <ShopPageHeader
            title={t("diverSignIn.sentTitle")}
            description={t("diverSignIn.sent", { shopName: shop.name })}
          />
          <Link
            href={publicSignInPath(shop.slug)}
            className={buttonClass({ variant: "secondary", size: "sm" })}
          >
            {t("diverSignIn.tryAnother")}
          </Link>
        </>
      ) : (
        <>
          <ShopPageHeader
            title={t("diverSignIn.title")}
            description={t("diverSignIn.description")}
          />
          <SectionCard padding="lg">
            <form action={requestDiverSignIn.bind(null, shop.slug)} className="flex flex-col gap-4">
              {error ? (
                <FormStatus tone="danger">{t("diverSignIn.linkUnavailable")}</FormStatus>
              ) : null}
              <Field label={t("diverSignIn.email")}>
                <input
                  name="email"
                  type="email"
                  required
                  autoComplete="email"
                  maxLength={150}
                  className={controlClass}
                />
              </Field>
              <SubmitButton pendingLabel={t("words.busy.sending")} className={buttonClass()}>
                {t("diverSignIn.submit")}
              </SubmitButton>
            </form>
          </SectionCard>
        </>
      )}
    </main>
  );
}
