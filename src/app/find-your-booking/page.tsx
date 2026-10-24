import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { MarketingNav } from "@/app/_components/MarketingNav";
import { MarketingFooter } from "@/components/MarketingFooter";
import { SHELL_TITLE_CLASS } from "@/components/ui/typography";
import { getDb } from "@/db/client";
import { listShopsForDiverPicker } from "@/db/shops";
import { diverTranslator } from "@/i18n/messages";
import { requestLocale } from "@/i18n/request";
import { publicFindMyBookingPath } from "@/lib/public-routes";

// `instant = true`: the frame paints from the static shell while the locale
// and the shop list stream in behind this segment's `loading.tsx` (ADR
// 20260804-instant-navigation).
export const instant = true;

export const metadata: Metadata = {
  title: "Find your booking — DiveDay",
  description:
    "Booked a dive with a shop that uses DiveDay? Pick the shop and get your booking link again.",
};

/**
 * **DiveDay's door for a diver** (fourth review, item 50). Every shop footer
 * says "Bookings by DiveDay" and links home, so a diver who lost their link
 * and searches for DiveDay lands on a page for shop owners. The home page's
 * one quiet line brings them here: the listed shops, each leading to that
 * shop's own "Can't find your link?" row, opened by its fragment.
 *
 * **Nothing here asks for an email.** The lookup stays the shop's, behind its
 * own rate limits and its own answer that never says whether an address has a
 * booking (`sendFindMyBookingLinks`). This page only names shops the sitemap
 * already names (`listedShopScope`): never a demo, never a shop that opted
 * out of search, so the line under the list says where else the link is.
 */
export default async function FindYourBookingPage() {
  await connection();
  const [locale, shops] = await Promise.all([
    requestLocale(),
    getDb().then((db) => listShopsForDiverPicker(db)),
  ]);
  const t = diverTranslator(locale);
  return (
    <div className="flex flex-1 flex-col">
      <MarketingNav compactMobile />
      <main className="mx-auto w-full max-w-xl flex-1 px-6 py-12 sm:py-16">
        <h1 className={`${SHELL_TITLE_CLASS} text-balance`}>{t("findYourBooking.title")}</h1>
        <p className="mt-2 max-w-prose text-pretty text-muted">
          {t("findYourBooking.description")}
        </p>
        {shops.length > 0 ? (
          <>
            {/* The ledger's geometry, as on a shop's course list: the list
                steps 8px out so its rules run with the row's square fill, and
                the row keeps the room as its `px-2` (K-513). */}
            <ul
              aria-label={t("findYourBooking.listLabel")}
              className="-mx-2 mt-8 divide-y divide-border border-y border-border"
            >
              {shops.map((shop) => {
                const town = [shop.locality, shop.region].filter(Boolean).join(", ");
                return (
                  <li key={shop.slug}>
                    <Link
                      href={publicFindMyBookingPath(shop.slug)}
                      className="group flex flex-col gap-1 px-2 py-5 transition-colors hover:bg-surface-sunken focus-visible:focus-ring-inset"
                    >
                      <span className="font-medium group-hover:text-primary">{shop.name}</span>
                      {town ? <span className="text-sm text-muted">{town}</span> : null}
                    </Link>
                  </li>
                );
              })}
            </ul>
            <p className="mt-4 text-sm text-muted">{t("findYourBooking.notListed")}</p>
          </>
        ) : (
          <p className="mt-8 text-sm text-muted">{t("findYourBooking.empty")}</p>
        )}
      </main>
      <MarketingFooter />
    </div>
  );
}
