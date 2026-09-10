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
 * touches no roll-call row. A diver tapping a lobby screen must never be able
 * to move a name onto a boat.
 *
 * It **does** move `bookings.status`, which the counter and the roll-call
 * screen both read — an earlier draft here claimed otherwise, which was the one
 * claim that had to be true. So the tablet's arrivals are told apart from a
 * staffer's everywhere a person reads them
 * (`listSelfReportedArrivalBookingIds`), and the tablet answers only for a
 * departure inside its own short window and never for a diver whose arrival a
 * person should be present for — stated support needs, or a minor.
 *
 * The link is the same `display_tokens` credential the departures board uses
 * (N-23), minted with `purpose: "check_in"` and revoked from the same settings
 * row. `verifyDisplayToken` matches the purpose in its predicate, so a board
 * link — which a shop hands to whoever mounts a TV — cannot open a surface that
 * writes.
 *
 * **One refusal, in words and in wall-clock time.** A miss, an ambiguous
 * surname, a sailed departure, a cancelled seat and a diver readiness will not
 * clear are one identical sentence, so a lobby screen cannot be used to work
 * out which of two people has a medical hold. The words alone did not carry
 * that: reaching the sentence from a miss is one query, and reaching it from a
 * blocked diver is a transaction with a row lock and a readiness read, so
 * latency told them apart (issue #1608). Every answer is now held to
 * `KIOSK_RESPONSE_FLOOR_MS`, the success path included. What the floor does not
 * cover, said plainly: a database slow enough to push the readiness read past
 * the floor leaks the difference again.
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
      {/* **The box sits where a standing person's hands are**, not at the top
          of the glass. This screen is a tablet on a counter and nothing else
          competes for the space, so the console takes the room the header
          leaves and centres in it — pinned to the top it read as a page still
          loading, with two thirds of the device blank underneath. The header
          stays put, because a diver crossing the lobby is reading the shop's
          name and the date from further away than the prompt. */}
      <div className="flex flex-1 flex-col justify-center py-6">
        <p className="text-[1.75rem] leading-tight font-bold text-balance">{t("kiosk.title")}</p>
        <KioskConsole
          token={token}
          copy={{
            prompt: t("kiosk.prompt"),
            submit: t("kiosk.submit"),
            submitting: t("kiosk.submitting"),
          }}
        />
      </div>
    </main>
  );
}
