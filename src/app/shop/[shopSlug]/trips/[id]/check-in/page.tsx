import type { Metadata } from "next";
import { revalidatePath } from "next/cache";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { EarnedMoment } from "@/components/EarnedMoment";
import { FlashParams } from "@/components/FlashParams";
import { ShopNotice } from "@/components/ShopPageHeader";
import { SubmitButton } from "@/components/SubmitButton";
import { getDb } from "@/db/client";
import { getTripManifest, recordRollCall } from "@/db/manifests";
import { getTripRequirements } from "@/db/readiness";
import { getShopById } from "@/db/shops";
import { buildCheckInChecks, type CheckInCheck } from "@/lib/check-in";
import { formatShortDate, formatTimeRangeTz } from "@/lib/format";
import type { TripManifest } from "@/lib/manifests";
import { requireStaffSession } from "@/lib/session";

export const metadata: Metadata = {
  title: "Check-in — Scuba",
};

const boardSchema = z.object({ bookingId: z.string().uuid() });

const NOTICE_MESSAGES: Record<string, { tone: "success" | "danger"; text: string }> = {
  boarded: { tone: "success", text: "Aboard — next diver." },
  "not-ready": {
    tone: "danger",
    text: "That diver is still blocked. Clear the listed requirement before boarding.",
  },
  error: { tone: "danger", text: "That didn’t save. Refresh and try again." },
};

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
  searchParams,
}: {
  params: Promise<{ shopSlug: string; id: string }>;
  searchParams: Promise<{ notice?: string }>;
}) {
  const session = await requireStaffSession();
  const { shopSlug, id: tripId } = await params;
  const { notice } = await searchParams;
  const db = await getDb();
  const shop = await getShopById(db, session.user.shopId);
  if (!shop) notFound();
  const [manifest, requirement] = await Promise.all([
    getTripManifest(db, shop.id, tripId, "departure"),
    getTripRequirements(db, shop.id, tripId),
  ]);
  if (!manifest) notFound();

  const back = `/shop/${shopSlug}/trips/${tripId}/check-in`;
  const banner = notice ? NOTICE_MESSAGES[notice] : undefined;
  const { totalDivers, boarded, blocked } = manifest.summary;
  const allAboard = totalDivers > 0 && boarded === totalDivers;
  const remaining = totalDivers - boarded - blocked;
  const divers = [...manifest.divers].sort((a, b) => checkInRank(a) - checkInRank(b));

  async function boardAction(formData: FormData) {
    "use server";
    const staff = await requireStaffSession();
    const parsed = boardSchema.safeParse(Object.fromEntries(formData));
    if (!parsed.success) redirect(`${back}?notice=error`);
    const outcome = await recordRollCall(await getDb(), {
      shopId: staff.user.shopId,
      tripId,
      bookingId: parsed.data.bookingId,
      recordedByPersonId: staff.user.personId,
      status: "boarded",
      checkpoint: "departure",
    });
    if (!outcome.ok) {
      redirect(`${back}?notice=${outcome.reason === "not_ready" ? "not-ready" : "error"}`);
    }
    revalidatePath(back);
    redirect(`${back}?notice=boarded`);
  }

  return (
    <main className="boat-mode mx-auto w-full max-w-3xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <FlashParams params={["notice"]} />
      <Link
        href={`/shop/${shopSlug}/trips/${tripId}`}
        className="text-sm font-medium text-primary hover:underline"
      >
        ← Back to trip
      </Link>
      <header className="mt-4">
        <p className="text-sm font-medium tracking-widest text-primary uppercase">Check-in</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">{manifest.trip.title}</h1>
        <p className="mt-1 text-muted">
          {formatShortDate(manifest.trip.startsAt, "en-US", shop.timezone)} ·{" "}
          {formatTimeRangeTz(manifest.trip.startsAt, manifest.trip.endsAt, "en-US", shop.timezone)}
        </p>
      </header>

      {banner ? (
        <div className="mt-6">
          <ShopNotice tone={banner.tone} role={banner.tone === "danger" ? "alert" : "status"}>
            {banner.text}
          </ShopNotice>
        </div>
      ) : null}

      {allAboard ? (
        <EarnedMoment className="mt-6" eyebrow="Check-in complete" title="Everyone’s aboard ⚓">
          <p>
            All {totalDivers} {totalDivers === 1 ? "diver is" : "divers are"} boarded. Roll call and
            notes live on the{" "}
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
        <section className="mt-6 rounded-2xl border border-primary/30 bg-surface p-4 shadow-sm sm:p-5">
          <div className="flex items-center justify-between gap-3">
            <p className="text-lg font-bold">
              <span className="tabular-nums">{boarded}</span> of{" "}
              <span className="tabular-nums">{totalDivers}</span> aboard
            </p>
            <Link
              href={`/shop/${shopSlug}/trips/${tripId}/manifest`}
              className="text-sm font-semibold text-primary hover:underline"
            >
              Full manifest →
            </Link>
          </div>
          <p className="mt-1 text-sm font-medium text-muted">
            {remaining > 0
              ? `${remaining} ready to board${blocked > 0 ? `, ${blocked} still blocked` : ""}.`
              : blocked > 0
                ? `${blocked} ${blocked === 1 ? "diver is" : "divers are"} blocked and can’t board yet.`
                : "No one is booked on this departure yet."}
          </p>
        </section>
      )}

      <ul className="mt-6 flex flex-col gap-3">
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
                    <span className="font-semibold text-foreground">Gear:</span>{" "}
                    {diver.gear.length > 0
                      ? diver.gear.map((item) => item.label).join(", ")
                      : "None assigned"}
                  </p>
                  {isBlocked ? (
                    <ul className="mt-2 flex flex-col gap-1 text-sm text-danger">
                      {diver.readiness.blockers.map((blocker) => (
                        <li key={blocker.code}>• {blocker.message}</li>
                      ))}
                    </ul>
                  ) : null}
                </div>
                <div className="shrink-0">
                  {isBoarded ? (
                    <span className="inline-flex min-h-14 items-center justify-center rounded-lg bg-success/10 px-5 text-base font-semibold text-success">
                      Aboard ✓
                    </span>
                  ) : isBlocked ? (
                    <Link
                      href={`/shop/${shopSlug}/trips/${tripId}#booking-${diver.bookingId}`}
                      className="inline-flex min-h-14 w-full items-center justify-center rounded-lg border border-border px-5 text-base font-semibold hover:bg-surface-sunken sm:w-auto"
                    >
                      Resolve blockers
                    </Link>
                  ) : (
                    <form action={boardAction}>
                      <input type="hidden" name="bookingId" value={diver.bookingId} />
                      <SubmitButton
                        pendingLabel="Boarding…"
                        className="flex min-h-14 w-full touch-manipulation items-center justify-center rounded-lg bg-primary px-6 text-base font-semibold text-primary-foreground transition-[transform,opacity] hover:bg-primary-hover active:scale-[0.99] disabled:cursor-wait disabled:opacity-70 sm:w-auto"
                      >
                        Board
                      </SubmitButton>
                    </form>
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
