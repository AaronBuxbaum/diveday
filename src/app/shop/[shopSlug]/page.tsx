import type { Metadata } from "next";
import Link from "next/link";
import { FlashParams } from "@/components/FlashParams";
import { ShopNotice } from "@/components/ShopPageHeader";
import { DepartureBoard } from "@/components/today/DepartureBoard";
import { TodayQueue } from "@/components/today/TodayQueue";
import { buttonClass } from "@/components/ui/button";
import { getDb } from "@/db/client";
import { getShopById } from "@/db/shops";
import { getTodayWork } from "@/db/today";
import { formatShortDate, formatTime } from "@/lib/format";
import { requireStaffSession } from "@/lib/session";
import { summarizeDay } from "@/lib/today";

export const metadata: Metadata = {
  title: "Today — DiveDay",
};

/**
 * Today is a work queue, not a dashboard. Two questions, in order: can the
 * boats leaving today sail, and who needs me before they do? Anything a nav
 * click already answers — the schedule, the diver list — is
 * deliberately not repeated here.
 */
export default async function ShopPage({
  params,
  searchParams,
}: {
  params: Promise<{ shopSlug: string }>;
  searchParams: Promise<{ created?: string; series?: string; reset?: string; email?: string }>;
}) {
  const session = await requireStaffSession();
  const { shopSlug } = await params;
  const { created, series, reset, email } = await searchParams;
  const seriesCount = series ? Number.parseInt(series, 10) : 0;
  const db = await getDb();
  const shop = await getShopById(db, session.user.shopId);
  if (!shop) return null;

  const now = new Date();
  const { departures, actions, nextDeparture } = await getTodayWork(
    db,
    shop.id,
    shopSlug,
    shop.timezone,
    now,
  );
  const firstName = session.user.name?.split(" ")[0] ?? "there";

  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <FlashParams params={["created", "series", "reset", "email"]} />

      <header className="mb-8">
        <p className="text-xs font-semibold tracking-[0.18em] text-primary uppercase">
          {formatShortDate(now, "en-US", shop.timezone)}
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">
          Good to see you, {firstName}
        </h1>
        <p className="mt-2 max-w-2xl text-lg text-muted">
          {summarizeDay(
            actions,
            departures.length,
            departures.reduce((total, departure) => total + departure.blocked, 0),
          )}
        </p>
      </header>

      {created ? (
        <div className="mb-6">
          <ShopNotice>
            {seriesCount > 1
              ? `“${created}” is on the board — ${seriesCount} trips scheduled. 🤙`
              : `“${created}” is on the board. 🤙`}
          </ShopNotice>
        </div>
      ) : null}
      {reset ? (
        <div className="mb-6">
          <ShopNotice tone="neutral">Demo data reset — fresh boat, clean slate. 🤿</ShopNotice>
        </div>
      ) : null}
      {email ? (
        <div className="mb-6">
          <ShopNotice tone={email === "sent" ? "success" : "danger"}>
            {email === "sent"
              ? "Confirmation email re-sent."
              : "That email still couldn’t be sent — check the address and email configuration."}
          </ShopNotice>
        </div>
      ) : null}

      <DepartureBoard departures={departures} shopSlug={shopSlug} timeZone={shop.timezone} />

      {departures.length === 0 ? (
        <section
          aria-labelledby="no-departures-heading"
          className="mb-10 rounded-2xl border border-border bg-surface p-5 sm:p-6"
        >
          <h2 id="no-departures-heading" className="font-semibold">
            No boats out today
          </h2>
          {nextDeparture ? (
            <p className="mt-1 text-muted">
              Next up is{" "}
              <Link
                href={`/shop/${shopSlug}/trips/${nextDeparture.tripId}`}
                className="font-medium text-primary hover:underline"
              >
                {nextDeparture.title}
              </Link>{" "}
              on {formatShortDate(nextDeparture.startsAt, "en-US", shop.timezone)} at{" "}
              {formatTime(nextDeparture.startsAt, "en-US", shop.timezone)}.
            </p>
          ) : (
            <>
              <p className="mt-1 text-muted">
                Nothing is on the books yet. Schedule a charter and it will show up here the morning
                it sails.
              </p>
              <Link
                href={`/shop/${shopSlug}/trips/new`}
                className={buttonClass({ className: "mt-4" })}
              >
                Schedule a trip
              </Link>
            </>
          )}
        </section>
      ) : null}

      <TodayQueue actions={actions} shopSlug={shopSlug} />
    </main>
  );
}
