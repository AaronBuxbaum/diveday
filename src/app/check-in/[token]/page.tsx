import type { Metadata } from "next";
import { after, connection } from "next/server";
import { EntryDone } from "@/components/account/EntryShell";
import { getDb } from "@/db/client";
import { touchDisplayToken, verifyDisplayToken } from "@/db/display-tokens";
import { getShopById } from "@/db/shops";
import { diverTranslator } from "@/i18n/messages";
import { requestLocale } from "@/i18n/request";
import { nowDate } from "@/lib/clock";
import { formatShortDate } from "@/lib/format";
import { KioskConsole } from "./_components/KioskConsole";

// `instant = true`: the segment's `loading.tsx` is the boundary, and the
// tablet paints its frame before the token verifies. See ADR
// 20260804-instant-navigation.
export const instant = true;

/**
 * A tablet on a counter is never something to index — the URL is the
 * credential (docs/engineering/capability-telemetry-runbook.md). No Open
 * Graph, no JSON-LD: nothing here describes a page anyone should share.
 */
export const metadata: Metadata = {
  title: "Check in — DiveDay",
  robots: { index: false, follow: false },
};

/**
 * **Self check-in at the counter** (N-24): a diver types their last name on a
 * tablet in the lobby and reads "You're set" or "See the desk", behind a
 * revocable display link and no sign-in.
 *
 * **What it records is an arrival, and it can never record a boarding.**
 * Arrival is the desk's question — is this person here? — and boarding is the
 * rail's, performed by a crew member with the diver in front of them at roll
 * call. The two are kept apart at the table (`arrival_status` carries no
 * `boarded` value) and in the writer this page reaches, `checkInAtKiosk`, which
 * touches nothing the manifest reads. A diver tapping a lobby screen must never
 * be able to move a name onto a boat.
 *
 * The link is the same `display_tokens` credential the departures board uses
 * (N-23), minted with `purpose: "check_in"` and revoked from the same settings
 * row. `verifyDisplayToken` matches the purpose in its predicate, so a board
 * link — which a shop hands to whoever mounts a TV — cannot open a surface that
 * writes.
 *
 * Display type, and deliberately almost nothing on it: a shop's name, today's
 * date, one box. Everything else this page could know about the day belongs to
 * the board, which is a different link on a different screen.
 */
export default async function KioskCheckInPage({ params }: { params: Promise<{ token: string }> }) {
  await connection();
  const { token } = await params;
  const db = await getDb();
  // One answer for every failure — never ours, revoked this morning, or minted
  // for the board rather than the counter — so a holder cannot tell them apart.
  // A capability route refuses **in place**, in its own words, rather than by
  // throwing: DiveDay's app-wide 404 ends in a button to a software sales page,
  // which is the wrong answer for whoever is standing at this counter
  // (`src/app/capability-refusals.test.ts`).
  const display = await verifyDisplayToken(db, { token, purpose: "check_in" });
  const shop = display ? await getShopById(db, display.shopId) : null;
  if (!display || !shop) {
    const anonT = diverTranslator(await requestLocale());
    return (
      <EntryDone
        glyph="expired"
        title={anonT("kiosk.unavailableHeading")}
        text={anonT("kiosk.unavailableBody")}
      />
    );
  }

  const now = nowDate();
  const locale = await requestLocale(shop.defaultLocale);
  const t = diverTranslator(locale);
  // Off the response path: the stamp is for the settings page, not the counter.
  after(() => touchDisplayToken(db, { id: display.id, now }));

  return (
    <main className="boat-mode mx-auto flex min-h-screen w-full max-w-2xl flex-col px-6 py-8 text-foreground sm:px-10 sm:py-12">
      <header className="flex flex-wrap items-end justify-between gap-x-8 gap-y-2">
        <h1 className="text-[2rem] leading-tight font-bold tracking-tight text-balance">
          {shop.name}
        </h1>
        <p className="text-[1.25rem] leading-tight text-muted tabular-nums">
          {formatShortDate(now, locale, shop.timezone)}
        </p>
      </header>
      <p className="mt-6 text-[1.75rem] leading-tight font-bold text-balance">{t("kiosk.title")}</p>
      <KioskConsole
        token={token}
        copy={{
          prompt: t("kiosk.prompt"),
          submit: t("kiosk.submit"),
          submitting: t("kiosk.submitting"),
        }}
      />
    </main>
  );
}
