import type { Metadata } from "next";
import { revalidatePath } from "next/cache";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import {
  RollCallButton,
  type RollCallResult,
} from "@/app/shop/[shopSlug]/trips/[id]/_components/RollCallButton";
import { TripSubNav } from "@/app/shop/[shopSlug]/trips/[id]/_components/TripSubNav";
import { ConnectivityStatus } from "@/components/ConnectivityStatus";
import { EarnedMoment } from "@/components/EarnedMoment";
import { buttonClass } from "@/components/ui/button";
import { getDb } from "@/db/client";
import { getTripManifest, recordRollCall } from "@/db/manifests";
import { getTripRequirements } from "@/db/readiness";
import { getShopById } from "@/db/shops";
import { buildCheckInChecks, type CheckInCheck } from "@/lib/check-in";
import { formatDateTimeTz, formatShortDate, formatTimeRangeTz } from "@/lib/format";
import type { TripManifest } from "@/lib/manifests";
import { requireStaffSession } from "@/lib/session";

export const metadata: Metadata = {
  title: "Check-in — Scuba",
};

// "cleared" is the un-board: staff re-tapped "Aboard ✓" to correct a mis-tap,
// recorded as its own event so the audit trail keeps the correction.
const boardSchema = z.object({
  bookingId: z.string().uuid(),
  status: z.enum(["boarded", "cleared"]),
});

/** Board the ready divers first; blocked ones sit below until cleared. */
function checkInRank(diver: TripManifest["divers"][number]): number {
  if (diver.rollCall?.state === "boarded") return 2;
  if (diver.readiness.status === "blocked") return 1;
  return 0;
}

function Check({ check }: { check: CheckInCheck }) {
  return (
    <span
      className={
        check.ok
          ? "inline-flex items-center gap-1.5 rounded-full bg-success/10 px-3 py-1 text-sm font-semibold text-success"
          : "inline-flex items-center gap-1.5 rounded-full bg-danger/10 px-3 py-1 text-sm font-semibold text-danger"
      }
      title={check.detail}
    >
      <span aria-hidden="true">{check.ok ? "✓" : "✕"}</span>
      {check.label}
    </span>
  );
}

export default async function CheckInPage({
  params,
}: {
  params: Promise<{ shopSlug: string; id: string }>;
}) {
  const session = await requireStaffSession();
  const { shopSlug, id: tripId } = await params;
  const db = await getDb();
  const shop = await getShopById(db, session.user.shopId);
  if (!shop) notFound();
  const [manifest, requirement] = await Promise.all([
    getTripManifest(db, shop.id, tripId, "departure"),
    getTripRequirements(db, shop.id, tripId),
  ]);
  if (!manifest) notFound();

  const now = new Date();
  const back = `/shop/${shopSlug}/trips/${tripId}/check-in`;
  const { totalDivers, boarded, blocked } = manifest.summary;
  const allAboard = totalDivers > 0 && boarded === totalDivers;
  const remaining = Math.max(0, totalDivers - boarded - blocked);
  const divers = [...manifest.divers].sort((a, b) => checkInRank(a) - checkInRank(b));

  async function boardAction(_prev: RollCallResult, formData: FormData): Promise<RollCallResult> {
    "use server";
    const staff = await requireStaffSession();
    const parsed = boardSchema.safeParse(Object.fromEntries(formData));
    if (!parsed.success) return { ok: false, reason: "error" };
    // Readiness is re-checked here, on the server, at board time — the pending
    // card on the client is only ever a hint until this returns. A dropped
    // connection or a throw returns the worded rollback rather than rejecting
    // (which would leave the card silently reverted on flaky marina Wi-Fi).
    try {
      const outcome = await recordRollCall(await getDb(), {
        shopId: staff.user.shopId,
        tripId,
        bookingId: parsed.data.bookingId,
        recordedByPersonId: staff.user.personId,
        status: parsed.data.status,
        checkpoint: "departure",
      });
      if (!outcome.ok) {
        return { ok: false, reason: outcome.reason === "not_ready" ? "not_ready" : "error" };
      }
    } catch {
      return { ok: false, reason: "error" };
    }
    // Settle in place — no redirect, so the card flips to Aboard ✓ without a
    // full-page round trip.
    revalidatePath(back);
    return { ok: true };
  }

  return (
    <main className="boat-mode mx-auto w-full max-w-3xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <a
        href="#boarding-list"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-lg focus:bg-primary focus:px-4 focus:py-3 focus:text-primary-foreground"
      >
        Skip to boarding list
      </a>
      <header>
        <p className="text-sm font-medium tracking-widest text-primary uppercase">Check-in</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">{manifest.trip.title}</h1>
        <p className="mt-1 text-muted">
          {formatShortDate(manifest.trip.startsAt, "en-US", shop.timezone)} ·{" "}
          {formatTimeRangeTz(manifest.trip.startsAt, manifest.trip.endsAt, "en-US", shop.timezone)}
        </p>
      </header>

      <TripSubNav shopSlug={shopSlug} tripId={tripId} current="check-in" className="mt-5" />

      {allAboard ? (
        <EarnedMoment className="mt-6" eyebrow="Check-in complete" title="All divers aboard ⚓">
          <p>
            All {totalDivers} {totalDivers === 1 ? "diver is" : "divers are"} boarded. Crew, notes,
            and after-dive roll call live on the{" "}
            <Link
              href={`/shop/${shopSlug}/trips/${tripId}/manifest`}
              className="font-semibold text-primary hover:underline"
            >
              full manifest
            </Link>
            .
          </p>
        </EarnedMoment>
      ) : (
        <section
          aria-labelledby="checkin-progress"
          className="sticky top-16 z-10 mt-6 rounded-2xl border border-primary/30 bg-surface/95 p-4 shadow-lg backdrop-blur sm:p-5"
        >
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
            <p id="checkin-progress" className="text-lg font-bold">
              <span className="tabular-nums">{boarded}</span> of{" "}
              <span className="tabular-nums">{totalDivers}</span> aboard
            </p>
            <div className="flex items-center gap-3">
              <ConnectivityStatus offlineLabel="No signal · board may be stale" />
              <Link
                href={`/shop/${shopSlug}/trips/${tripId}/manifest`}
                className="text-sm font-semibold text-primary hover:underline"
              >
                Full manifest →
              </Link>
            </div>
          </div>
          <p className="mt-1 text-base font-medium text-muted">
            {remaining > 0
              ? `${remaining} ready to board${blocked > 0 ? `, ${blocked} still blocked` : ""}.`
              : blocked > 0
                ? `${blocked} ${blocked === 1 ? "diver is" : "divers are"} blocked and can’t board yet.`
                : "No one is booked on this departure yet."}
          </p>
          <p className="mt-1 text-sm text-muted">
            Readiness as of {formatDateTimeTz(now, "en-US", shop.timezone)} — re-checked the instant
            you board.
          </p>
        </section>
      )}

      <ul id="boarding-list" className="mt-6 flex flex-col gap-3">
        {divers.map((diver) => {
          const isBoarded = diver.rollCall?.state === "boarded";
          const isBlocked = diver.readiness.status === "blocked";
          const checks = buildCheckInChecks(requirement, diver.readiness);
          return (
            <li
              key={diver.bookingId}
              className={
                isBoarded
                  ? "rounded-2xl border border-l-4 border-border border-l-success bg-surface px-4 py-4 sm:px-5"
                  : isBlocked
                    ? "rounded-2xl border border-l-4 border-border border-l-danger bg-danger/5 px-4 py-4 sm:px-5"
                    : "rounded-2xl border border-l-4 border-border border-l-primary bg-surface px-4 py-4 shadow-sm sm:px-5"
              }
            >
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <h2 className="text-xl font-semibold">{diver.fullName}</h2>
                  {checks.length > 0 ? (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {checks.map((check) => (
                        <Check key={check.category} check={check} />
                      ))}
                    </div>
                  ) : null}
                  <p className="mt-2 text-sm text-muted">
                    <span className="font-semibold text-foreground">Rental fit:</span>{" "}
                    {diver.rentalFit.text}
                    {diver.nitroxRequested ? (
                      <span className="font-semibold text-foreground"> · Nitrox requested</span>
                    ) : null}
                  </p>
                  {isBlocked ? (
                    <ul className="mt-2 flex flex-col gap-1 text-base text-danger">
                      {diver.readiness.blockers.map((blocker) => (
                        <li key={blocker.code}>• {blocker.message}</li>
                      ))}
                    </ul>
                  ) : null}
                </div>
                <div className="shrink-0 sm:text-right">
                  {isBoarded ? (
                    <>
                      <RollCallButton
                        action={boardAction}
                        bookingId={diver.bookingId}
                        status="cleared"
                        label="Aboard ✓"
                        pendingLabel="Undoing…"
                        className="inline-flex min-h-14 w-full touch-manipulation items-center justify-center gap-1 rounded-lg bg-success/10 px-6 text-base font-semibold text-success transition-[transform,opacity] active:scale-[0.99] disabled:cursor-wait disabled:opacity-70 sm:w-auto"
                      />
                      <p className="mt-1 text-sm text-muted">Tap to undo.</p>
                    </>
                  ) : isBlocked ? (
                    <Link
                      href={`/shop/${shopSlug}/trips/${tripId}#booking-${diver.bookingId}`}
                      className={buttonClass({
                        variant: "secondary",
                        size: "boat",
                        className: "w-full sm:w-auto",
                      })}
                    >
                      Resolve blockers
                    </Link>
                  ) : (
                    <RollCallButton
                      action={boardAction}
                      bookingId={diver.bookingId}
                      status="boarded"
                      label="Board"
                      pendingLabel="Boarding…"
                      className={buttonClass({
                        size: "boat",
                        className:
                          "w-full touch-manipulation transition-[transform,opacity] active:scale-[0.99] disabled:cursor-wait disabled:opacity-70 sm:w-auto",
                      })}
                    />
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ul>

      {totalDivers === 0 ? (
        <p className="mt-6 rounded-2xl border border-dashed border-border-strong bg-surface p-8 text-center text-muted">
          No one is booked on this departure yet. Bookings show up here ready to check in.
        </p>
      ) : null}
    </main>
  );
}
