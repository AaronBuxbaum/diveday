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
import { OfflineManifestManager } from "@/components/OfflineManifestManager";
import { PrintButton } from "@/components/PrintButton";
import { RollCallNote } from "@/components/RollCallNote";
import { getDb } from "@/db/client";
import { getTripManifests, recordRollCall, updateLatestRollCallNote } from "@/db/manifests";
import { getShopById } from "@/db/shops";
import { formatDateTimeTz, formatShortDate, formatTimeRangeTz } from "@/lib/format";
import {
  isRollCallCheckpoint,
  type RollCallCheckpoint,
  rollCallCheckpointLabel,
  rollCallCheckpoints,
  rollCallLabel,
} from "@/lib/manifests";
import { serializeManifests } from "@/lib/offline-manifests";
import { requireStaffSession } from "@/lib/session";

export const metadata: Metadata = {
  title: "Boat manifest — DiveDay",
};

const rollCallSchema = z.object({
  bookingId: z.string().uuid(),
  status: z.enum(["boarded", "not_boarded", "cleared"]),
  note: z.string().trim().max(300).optional(),
});

const noteSchema = z.object({
  bookingId: z.string().uuid(),
  checkpoint: z.string(),
  note: z.string().max(300),
});

export default async function TripManifestPage({
  params,
  searchParams,
}: {
  params: Promise<{ shopSlug: string; id: string }>;
  searchParams: Promise<{ checkpoint?: string }>;
}) {
  const session = await requireStaffSession();
  const { shopSlug, id: tripId } = await params;
  const { checkpoint: requestedCheckpoint } = await searchParams;
  const db = await getDb();
  const shop = await getShopById(db, session.user.shopId);
  if (!shop) notFound();
  const completeManifests = await getTripManifests(db, shop.id, tripId);
  const departureManifest = completeManifests?.[0];
  if (!departureManifest || !completeManifests) notFound();
  const plannedDives = departureManifest.trip.plannedDives;
  const checkpoints = rollCallCheckpoints(plannedDives);
  const checkpoint: RollCallCheckpoint =
    requestedCheckpoint && isRollCallCheckpoint(requestedCheckpoint, plannedDives)
      ? requestedCheckpoint
      : "departure";
  const manifest = completeManifests.find((entry) => entry.checkpoint === checkpoint);
  if (!manifest) notFound();
  const rollCallComplete = manifest.summary.totalDivers > 0 && manifest.summary.awaiting === 0;
  const back = `/shop/${shopSlug}/trips/${tripId}/manifest?checkpoint=${checkpoint}`;

  async function rollCallAction(
    _prev: RollCallResult,
    formData: FormData,
  ): Promise<RollCallResult> {
    "use server";
    const staff = await requireStaffSession();
    const parsed = rollCallSchema.safeParse(Object.fromEntries(formData));
    if (!parsed.success) return { ok: false, reason: "error" };
    // A throw or dropped connection returns the worded rollback rather than
    // rejecting the action, which would silently revert the card on flaky Wi-Fi.
    try {
      const outcome = await recordRollCall(await getDb(), {
        shopId: staff.user.shopId,
        tripId,
        bookingId: parsed.data.bookingId,
        recordedByPersonId: staff.user.personId,
        status: parsed.data.status,
        checkpoint,
        note: parsed.data.note,
      });
      if (!outcome.ok) {
        return { ok: false, reason: outcome.reason === "not_ready" ? "not_ready" : "error" };
      }
    } catch {
      return { ok: false, reason: "error" };
    }
    // Settle the card in place instead of a full-page redirect per tap.
    revalidatePath(back.split("?")[0]);
    return { ok: true };
  }

  async function saveRollCallNoteAction(
    bookingId: string,
    checkpointValue: string,
    note: string,
  ): Promise<{ ok: boolean; saved: boolean }> {
    "use server";
    const staff = await requireStaffSession();
    const parsed = noteSchema.safeParse({ bookingId, checkpoint: checkpointValue, note });
    if (!parsed.success) return { ok: false, saved: false };
    if (!isRollCallCheckpoint(parsed.data.checkpoint, plannedDives)) {
      return { ok: false, saved: false };
    }
    const saved = await updateLatestRollCallNote(await getDb(), {
      shopId: staff.user.shopId,
      tripId,
      bookingId: parsed.data.bookingId,
      checkpoint: parsed.data.checkpoint,
      note: parsed.data.note,
    });
    if (saved) revalidatePath(back.split("?")[0]);
    return { ok: true, saved };
  }

  return (
    <main className="boat-mode mx-auto w-full max-w-4xl flex-1 px-6 py-12 print:max-w-none print:px-0 print:py-0">
      <a
        href="#roll-call-list"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-lg focus:bg-primary focus:px-4 focus:py-3 focus:text-primary-foreground"
      >
        Skip to roll call
      </a>
      <TripSubNav
        shopSlug={shopSlug}
        tripId={tripId}
        current="manifest"
        className="mb-5 print:hidden"
      />
      <header className="flex flex-wrap items-start justify-between gap-5 border-b border-border pb-7 print:mt-0">
        <div>
          <h1 className="text-sm font-medium tracking-widest text-primary uppercase">
            Boat manifest
          </h1>
          <h2 className="mt-2 text-3xl font-semibold tracking-tight">{manifest.trip.title}</h2>
          <p className="mt-1 text-muted">
            {formatShortDate(manifest.trip.startsAt, "en-US", shop.timezone)} ·{" "}
            {formatTimeRangeTz(
              manifest.trip.startsAt,
              manifest.trip.endsAt,
              "en-US",
              shop.timezone,
            )}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3 print:hidden">
          <span className="rounded-full bg-primary/10 px-3 py-1 text-sm font-medium text-primary">
            Live source · offline copy available
          </span>
          <PrintButton />
        </div>
      </header>
      <OfflineManifestManager
        payload={serializeManifests(completeManifests, {
          slug: shopSlug,
          name: shop.name,
          timezone: shop.timezone,
        })}
      />

      <section className="mt-7 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {[
          ["Divers", manifest.summary.totalDivers],
          ["Ready", manifest.summary.ready],
          ["Blocked", manifest.summary.blocked],
          ["Boarded", manifest.summary.boarded],
          ["Not boarded", manifest.summary.notBoarded],
          ["Awaiting", manifest.summary.awaiting],
        ].map(([label, value]) => (
          <div key={String(label)} className="rounded-lg border border-border bg-surface px-4 py-3">
            <p className="text-xs font-medium tracking-wide text-muted uppercase">{label}</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
          </div>
        ))}
      </section>

      <nav
        className="mt-7 flex gap-2 overflow-x-auto pb-2 print:hidden"
        aria-label="Roll-call checkpoint"
      >
        {checkpoints.map((value) => (
          <Link
            key={value}
            href={`/shop/${shopSlug}/trips/${tripId}/manifest?checkpoint=${value}`}
            scroll={false}
            className={
              value === checkpoint
                ? "inline-flex min-h-11 shrink-0 items-center rounded-lg bg-primary px-4 py-2.5 font-semibold text-primary-foreground"
                : "inline-flex min-h-11 shrink-0 items-center rounded-lg border border-border-strong px-4 py-2.5 font-semibold hover:bg-surface-sunken"
            }
          >
            {rollCallCheckpointLabel(value)}
          </Link>
        ))}
      </nav>

      <section
        aria-labelledby="roll-call-progress-heading"
        className={
          rollCallComplete
            ? "boat-progress-panel rise-in sticky top-20 z-10 mt-4 rounded-2xl border border-accent/50 bg-accent/10 p-4 shadow-lg backdrop-blur print:hidden"
            : "boat-progress-panel sticky top-20 z-10 mt-4 rounded-2xl border border-primary/30 bg-surface/95 p-4 shadow-lg backdrop-blur print:hidden"
        }
      >
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-xs font-bold tracking-[0.16em] text-primary uppercase">
              Active checkpoint
            </p>
            <h2 id="roll-call-progress-heading" className="mt-1 text-lg font-bold">
              {rollCallComplete ? "Roll call complete ✦" : rollCallCheckpointLabel(checkpoint)}
            </h2>
          </div>
          <p className="text-base font-bold tabular-nums">
            {manifest.summary.totalDivers - manifest.summary.awaiting} of{" "}
            {manifest.summary.totalDivers} recorded
          </p>
        </div>
        <div
          className="mt-3 h-3 overflow-hidden rounded-full bg-surface-sunken"
          role="progressbar"
          aria-label="Roll-call progress"
          aria-valuemin={0}
          aria-valuemax={manifest.summary.totalDivers}
          aria-valuenow={manifest.summary.totalDivers - manifest.summary.awaiting}
        >
          <div
            className="h-full rounded-full bg-primary transition-[width] duration-200"
            style={{
              width: `${
                manifest.summary.totalDivers === 0
                  ? 0
                  : (
                      (manifest.summary.totalDivers - manifest.summary.awaiting) /
                        manifest.summary.totalDivers
                    ) * 100
              }%`,
            }}
          />
        </div>
        <p className="mt-2 text-sm font-semibold text-muted" aria-live="polite">
          {manifest.summary.awaiting === 0
            ? "Everyone has an explicit roll-call result. You’re ready for the next check."
            : String(manifest.summary.awaiting) +
              " " +
              (manifest.summary.awaiting === 1 ? "diver is" : "divers are") +
              " still awaiting a result."}
        </p>
      </section>

      {manifest.summary.blocked > 0 ? (
        <section className="mt-6 rounded-lg border border-warning/40 bg-warning/10 p-4">
          <h2 className="font-semibold text-warning">Readiness needs attention</h2>
          <p className="mt-1 text-sm text-muted">
            {manifest.summary.blocked} {manifest.summary.blocked === 1 ? "diver is" : "divers are"}{" "}
            blocked. They remain on this manifest and cannot be marked boarded until their readiness
            check clears.
          </p>
        </section>
      ) : null}

      <section className="mt-9">
        <h2 className="text-lg font-semibold">Crew</h2>
        {manifest.crew.length === 0 ? (
          <p className="mt-3 text-sm text-muted">No crew has been assigned to this trip yet.</p>
        ) : (
          <ul className="mt-3 flex flex-wrap gap-2">
            {manifest.crew.map((member) => (
              <li
                key={member.fullName}
                className="rounded-full bg-surface-sunken px-3 py-2 text-sm"
              >
                <strong>{member.fullName}</strong> · {member.roles.join(", ")}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section id="roll-call-list" className="mt-9">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">
              {rollCallCheckpointLabel(checkpoint)} roll call
            </h2>
            <p className="mt-1 text-sm text-muted">
              Check each diver here before departure. Every change is time-stamped with the staff
              member who made it.
            </p>
          </div>
          <p className="text-sm text-muted">Shop time: {shop.timezone}</p>
        </div>
        <ul className="mt-4 divide-y divide-border rounded-lg border border-border bg-surface">
          {manifest.divers.map((diver, index) => {
            const ready = diver.readiness.status === "ready";
            const rc = diver.rollCall;
            const boarded = rc?.state === "boarded";
            // "actioned" == a result staff recorded at *this* checkpoint. An
            // implied not-boarded is carried forward, so it is not yet actioned.
            const explicitNotBoarded = rc?.state === "not_boarded" && !rc.implied;
            const impliedNotBoarded = rc?.state === "not_boarded" && rc.implied === true;
            // Each roll-call state gets its own fill so staff can tell at a glance
            // who has been handled: boarded (green) and not boarded (slate) read as
            // done; awaiting (amber) and blocked (red) still need them.
            const rowClass = boarded
              ? "border-l-4 border-success bg-success/10 px-4 py-5 sm:px-5"
              : explicitNotBoarded
                ? "border-l-4 border-border-strong bg-surface-sunken px-4 py-5 sm:px-5"
                : impliedNotBoarded
                  ? "border-l-4 border-dashed border-border-strong bg-surface-sunken/50 px-4 py-5 sm:px-5"
                  : ready
                    ? "border-l-4 border-warning bg-warning/10 px-4 py-5 ring-1 ring-inset ring-warning/30 sm:px-5"
                    : "scroll-mt-32 border-l-4 border-danger bg-danger/5 px-4 py-5 sm:px-5";
            const rollCallPillClass = boarded
              ? "rounded-full bg-success/10 px-3 py-1 text-sm font-medium text-success"
              : explicitNotBoarded
                ? "rounded-full bg-foreground/10 px-3 py-1 text-sm font-medium text-foreground"
                : "rounded-full bg-surface-sunken px-3 py-1 text-sm font-medium text-muted";
            return (
              <li key={diver.bookingId} id={`roll-call-${diver.bookingId}`} className={rowClass}>
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-surface-sunken text-sm font-bold tabular-nums">
                        {String(index + 1).padStart(2, "0")}
                      </span>
                      <h3 className="text-lg font-semibold">{diver.fullName}</h3>
                      <span
                        className={
                          ready
                            ? "rounded-full bg-success/10 px-3 py-1 text-sm font-medium text-success"
                            : "rounded-full bg-danger/10 px-3 py-1 text-sm font-medium text-danger"
                        }
                      >
                        {ready ? "Ready to board" : "Blocked"}
                      </span>
                      <span className={rollCallPillClass}>{rollCallLabel(rc)}</span>
                    </div>
                    <div className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
                      <p>
                        <span className="font-bold">Emergency contact</span>
                        <span className="mt-0.5 block text-muted">
                          {diver.emergencyContactName && diver.emergencyContactPhone
                            ? `${diver.emergencyContactName} · ${diver.emergencyContactPhone}`
                            : "Not on file"}
                        </span>
                      </p>
                      <p>
                        <span className="font-bold">Rental fit</span>
                        <span className="mt-0.5 block text-muted">
                          {diver.rentalFit.text}
                          {diver.nitroxRequested ? " · Nitrox requested" : ""}
                        </span>
                      </p>
                    </div>
                    {!ready ? (
                      <ul className="mt-3 flex flex-col gap-1 text-sm text-danger">
                        {diver.readiness.blockers.map((blocker) => (
                          <li key={blocker.message}>• {blocker.message}</li>
                        ))}
                      </ul>
                    ) : null}
                    <details className="mt-3 max-w-xl rounded-xl border border-border/70 bg-surface-sunken/50 p-3 print:hidden">
                      <summary className="flex min-h-11 cursor-pointer items-center text-sm font-bold text-primary">
                        Add a note to this roll-call record
                      </summary>
                      <RollCallNote
                        bookingId={diver.bookingId}
                        checkpoint={checkpoint}
                        formId={`not-boarded-${diver.bookingId}`}
                        initialNote={rc && !rc.implied ? (rc.note ?? "") : ""}
                        canAutoSave={!!rc && !rc.implied}
                        saveNote={saveRollCallNoteAction}
                      />
                    </details>
                    {rc && !rc.implied ? (
                      <p className="mt-3 text-sm text-muted">
                        {rollCallLabel(rc)}{" "}
                        {formatDateTimeTz(rc.occurredAt, "en-US", shop.timezone)} by{" "}
                        {rc.recordedByName}
                        {rc.note ? ` · ${rc.note}` : ""}
                      </p>
                    ) : impliedNotBoarded ? (
                      <p className="mt-3 text-sm text-muted">
                        Carried forward — not boarded on an earlier checkpoint. Mark boarded to
                        bring them back on.
                      </p>
                    ) : null}
                  </div>
                  <div className="flex w-full shrink-0 flex-col gap-2 print:hidden sm:w-auto sm:flex-row sm:flex-wrap">
                    {ready ? (
                      <RollCallButton
                        action={rollCallAction}
                        bookingId={diver.bookingId}
                        status={boarded ? "cleared" : "boarded"}
                        label={boarded ? "Boarded ✓" : "Mark boarded"}
                        pendingLabel={boarded ? "Undoing…" : "Boarding…"}
                        className={
                          boarded
                            ? "flex min-h-14 w-full touch-manipulation items-center justify-center rounded-lg border border-success bg-success/15 px-5 text-base font-semibold text-success transition-[transform,opacity] active:scale-[0.99] disabled:cursor-wait disabled:opacity-70 sm:w-auto"
                            : "flex min-h-14 w-full touch-manipulation items-center justify-center rounded-lg bg-primary px-5 text-base font-semibold text-primary-foreground transition-[transform,opacity] hover:bg-primary-hover active:scale-[0.99] disabled:cursor-wait disabled:opacity-70 sm:w-auto"
                        }
                      />
                    ) : null}
                    <RollCallButton
                      action={rollCallAction}
                      bookingId={diver.bookingId}
                      status={explicitNotBoarded ? "cleared" : "not_boarded"}
                      label={explicitNotBoarded ? "Not boarded ✓" : "Mark not boarded"}
                      pendingLabel="Saving…"
                      formId={`not-boarded-${diver.bookingId}`}
                      className={
                        explicitNotBoarded
                          ? "flex min-h-14 w-full touch-manipulation items-center justify-center rounded-lg border border-border-strong bg-surface-sunken px-5 text-base font-semibold transition-[transform,opacity] active:scale-[0.99] disabled:cursor-wait disabled:opacity-70 sm:w-auto"
                          : "flex min-h-14 w-full touch-manipulation items-center justify-center rounded-lg border border-border px-5 text-base font-semibold transition-[transform,opacity] hover:bg-surface-sunken active:scale-[0.99] disabled:cursor-wait disabled:opacity-70 sm:w-auto"
                      }
                    />
                    {rc && !rc.implied ? (
                      <p className="text-xs text-muted sm:basis-full">
                        Tap the ✓ status again to undo.
                      </p>
                    ) : null}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      </section>
    </main>
  );
}
