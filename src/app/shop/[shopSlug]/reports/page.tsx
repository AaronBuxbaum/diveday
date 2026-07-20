import type { Metadata } from "next";
import Link from "next/link";
import { getDb } from "@/db/client";
import { getShopById } from "@/db/queries";
import { getOperationsReport } from "@/db/reports";
import { formatShortDate, formatTimeRange } from "@/lib/format";
import { requireStaffSession } from "@/lib/session";

export const metadata: Metadata = {
  title: "Operations report — Scuba",
};

export default async function ReportsPage({ params }: { params: Promise<{ shopSlug: string }> }) {
  const session = await requireStaffSession();
  const { shopSlug } = await params;
  const db = await getDb();
  const shop = await getShopById(db, session.user.shopId);
  if (!shop) return null;
  const report = await getOperationsReport(db, shop.id);

  return (
    <main className="mx-auto w-full max-w-4xl flex-1 px-6 py-16">
      <header>
        <p className="text-sm font-medium tracking-widest text-primary uppercase">{shop.name}</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">Operations at a glance</h1>
        <p className="mt-2 text-muted">
          A live, small-shop view of the work that matters before the next departure—not a separate
          dashboard to keep in sync.
        </p>
      </header>

      <section className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {[
          ["Upcoming", report.summary.upcomingSessions],
          ["Booked", report.summary.bookedDivers],
          ["Blocked", report.summary.readinessBlocked],
          ["Gear requests", report.summary.rentalRequests],
          ["Courses", report.summary.courseSessions],
          ["Need instructor", report.summary.unstaffedCourseSessions],
        ].map(([label, value]) => (
          <div key={String(label)} className="rounded-lg border border-border bg-surface px-4 py-3">
            <p className="text-xs font-medium tracking-wide text-muted uppercase">{label}</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
          </div>
        ))}
      </section>

      <section className="mt-10">
        <h2 className="text-lg font-semibold">Upcoming work</h2>
        {report.sessions.length === 0 ? (
          <p className="mt-4 rounded-lg border border-border bg-surface p-5 text-sm text-muted">
            Nothing upcoming yet. Schedule a charter or course session and this page will stay live.
          </p>
        ) : (
          <ul className="mt-4 divide-y divide-border rounded-lg border border-border bg-surface">
            {report.sessions.map((session) => (
              <li key={session.trip.id} className="px-4 py-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <h3 className="font-medium">{session.trip.title}</h3>
                    <p className="mt-1 text-sm text-muted">
                      {formatShortDate(session.trip.startsAt, "en-US", shop.timezone)} ·{" "}
                      {formatTimeRange(
                        session.trip.startsAt,
                        session.trip.endsAt,
                        "en-US",
                        shop.timezone,
                      )}
                      {session.trip.course ? ` · ${session.trip.course.title}` : ""}
                    </p>
                  </div>
                  <Link
                    href={`/shop/${shopSlug}/trips/${session.trip.id}`}
                    className="inline-flex min-h-11 shrink-0 items-center py-2 text-sm font-medium text-primary hover:underline"
                  >
                    Open session
                  </Link>
                </div>
                <div className="mt-3 flex flex-wrap gap-2 text-sm">
                  <span className="rounded-full bg-surface-sunken px-3 py-1">
                    {session.trip.booked} booked
                  </span>
                  <span
                    className={
                      session.readinessBlocked > 0
                        ? "rounded-full bg-danger/10 px-3 py-1 font-medium text-danger"
                        : "rounded-full bg-success/10 px-3 py-1 font-medium text-success"
                    }
                  >
                    {session.readinessBlocked === 0
                      ? "Readiness clear"
                      : `${session.readinessBlocked} readiness blocker${session.readinessBlocked === 1 ? "" : "s"}`}
                  </span>
                  {session.rentalRequests > 0 ? (
                    <span className="rounded-full bg-primary/10 px-3 py-1 font-medium text-primary">
                      {session.rentalRequests} gear request{session.rentalRequests === 1 ? "" : "s"}
                    </span>
                  ) : null}
                  {session.needsInstructor ? (
                    <span className="rounded-full bg-warning/10 px-3 py-1 font-medium text-warning">
                      Instructor needed before booking
                    </span>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
