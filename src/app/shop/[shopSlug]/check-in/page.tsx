import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ShopNotice, ShopPageHeader } from "@/components/ShopPageHeader";
import { Badge } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { listCheckInQueue } from "@/db/check-in";
import { getDb } from "@/db/client";
import { getShopBySlug } from "@/db/shops";
import { formatShortDate, formatTimeRange } from "@/lib/format";
import { requireStaffSession } from "@/lib/session";
import { checkInAction } from "./actions";
import { CheckInSearch } from "./CheckInSearch";

export const metadata: Metadata = {
  title: "Check-in — DiveDay",
};

const noticeCopy: Record<
  string,
  { tone: "success" | "danger" | "warning" | "neutral"; text: string }
> = {
  checked_in: { tone: "success", text: "Diver checked in. Next diver is ready when you are." },
  already_checked_in: { tone: "neutral", text: "That diver is already checked in." },
  not_ready: {
    tone: "warning",
    text: "Readiness changed — resolve the blocker before checking them in.",
  },
  not_bookable: { tone: "danger", text: "That booking is no longer available for check-in." },
  not_found: { tone: "danger", text: "That booking could not be found." },
  staff_not_found: { tone: "danger", text: "Your staff access could not be confirmed." },
  invalid: { tone: "danger", text: "Choose a diver from the queue before checking in." },
};

export default async function CheckInPage({
  params,
  searchParams,
}: {
  params: Promise<{ shopSlug: string }>;
  searchParams: Promise<{ q?: string; notice?: string }>;
}) {
  const session = await requireStaffSession();
  const { shopSlug } = await params;
  const { q, notice } = await searchParams;
  const db = await getDb();
  const shop = await getShopBySlug(db, shopSlug);
  if (!shop || shop.id !== session.user.shopId) notFound();

  const query = q?.trim() ?? "";
  const queue = await listCheckInQueue(db, shop.id, { query });
  const copy = notice ? noticeCopy[notice] : undefined;

  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6 sm:py-10">
      <ShopPageHeader
        eyebrow="Counter mode"
        title="Line-busting check-in"
        description="Scan a booking code or search a diver, confirm live readiness, and keep the line moving. Check-in is arrival status; boarding is still confirmed on the manifest."
      />

      {copy ? (
        <ShopNotice tone={copy.tone} className="mb-6">
          {copy.text}
        </ShopNotice>
      ) : null}

      <section className="rounded-2xl border border-border bg-surface p-4 shadow-sm sm:p-6">
        <CheckInSearch query={query} />
      </section>

      <section aria-label="Check-in queue" className="mt-8">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <h2 className="text-xl font-semibold">Ready at the counter</h2>
            <p className="mt-1 text-sm text-muted">
              {query ? `Search results for “${query}”.` : "Today’s departures and the next boat."}
            </p>
          </div>
          <Badge tone="neutral" tabularNums>
            {queue.length} {queue.length === 1 ? "diver" : "divers"}
          </Badge>
        </div>

        {queue.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border p-8 text-center">
            <h3 className="font-semibold">No one matches that scan</h3>
            <p className="mt-1 text-sm text-muted">
              Try the diver’s name, email, or full booking ID.
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {queue.map((row) => {
              const ready = row.readiness.status === "ready";
              const checkedIn = row.bookingStatus === "checked_in";
              return (
                <article
                  key={row.bookingId}
                  data-testid={`check-in-card-${row.bookingId}`}
                  className="rounded-2xl border border-border bg-surface p-4 shadow-sm sm:p-5"
                >
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-lg font-semibold">{row.personName}</h3>
                        {checkedIn ? <Badge tone="success">Checked in</Badge> : null}
                      </div>
                      <p className="mt-1 text-sm font-medium text-primary">{row.tripTitle}</p>
                      <p className="mt-1 text-sm text-muted">
                        {formatShortDate(row.startsAt, shop.defaultLocale, shop.timezone)} ·{" "}
                        {formatTimeRange(
                          row.startsAt,
                          row.endsAt,
                          shop.defaultLocale,
                          shop.timezone,
                        )}
                      </p>
                      {row.email ? (
                        <p className="mt-1 truncate text-xs text-muted">{row.email}</p>
                      ) : null}
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <Badge tone={ready ? "success" : "warning"}>
                        {ready ? "Ready" : "Needs attention"}
                      </Badge>
                      {checkedIn ? null : ready ? (
                        <form action={checkInAction.bind(null, shopSlug)}>
                          <input type="hidden" name="bookingId" value={row.bookingId} />
                          <button
                            type="submit"
                            className={buttonClass({ className: "whitespace-nowrap" })}
                            aria-label={`Check in ${row.personName}`}
                          >
                            Check in
                          </button>
                        </form>
                      ) : null}
                    </div>
                  </div>
                  {!ready ? (
                    <ul className="mt-4 space-y-1 border-t border-border pt-3 text-sm text-warning">
                      {row.readiness.blockers.slice(0, 3).map((blocker) => (
                        <li key={blocker.code}>• {blocker.message}</li>
                      ))}
                    </ul>
                  ) : null}
                </article>
              );
            })}
          </div>
        )}
      </section>
    </main>
  );
}
