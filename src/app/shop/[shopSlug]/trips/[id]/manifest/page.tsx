import type { Metadata } from "next";
import { revalidatePath } from "next/cache";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { FlashParams } from "@/components/FlashParams";
import { OfflineManifestManager } from "@/components/OfflineManifestManager";
import { PrintButton } from "@/components/PrintButton";
import { RestorePreservedScroll, ScrollPreservingForm } from "@/components/ScrollPreservingForm";
import { SubmitButton } from "@/components/SubmitButton";
import { getDb } from "@/db/client";
import { getTripManifests, recordRollCall } from "@/db/manifests";
import { getShopById } from "@/db/queries";
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
  title: "Boat manifest — Scuba",
};

const rollCallSchema = z.object({
  bookingId: z.string().uuid(),
  status: z.enum(["boarded", "not_boarded"]),
  note: z.string().trim().max(300).optional(),
});

const BANNERS: Record<string, { tone: "success" | "danger"; text: string }> = {
  boarded: { tone: "success", text: "Boarding recorded." },
  "not-boarded": { tone: "success", text: "Not-boarded status recorded." },
  "not-ready": {
    tone: "danger",
    text: "That diver is still blocked. Resolve the listed requirement before boarding.",
  },
  error: {
    tone: "danger",
    text: "That roll-call update could not be recorded. Refresh and try again.",
  },
};

export default async function TripManifestPage({
  params,
  searchParams,
}: {
  params: Promise<{ shopSlug: string; id: string }>;
  searchParams: Promise<{ notice?: string; checkpoint?: string }>;
}) {
  const session = await requireStaffSession();
  const { shopSlug, id: tripId } = await params;
  const { notice, checkpoint: requestedCheckpoint } = await searchParams;
  const db = await getDb();
  const shop = await getShopById(db, session.user.shopId);
  if (!shop) notFound();
  const completeManifests = await getTripManifests(db, shop.id, tripId);
  const departureManifest = completeManifests?.[0];
  if (!departureManifest || !completeManifests) notFound();
  const checkpoints = rollCallCheckpoints(departureManifest.trip.plannedDives);
  const checkpoint: RollCallCheckpoint =
    requestedCheckpoint &&
    isRollCallCheckpoint(requestedCheckpoint, departureManifest.trip.plannedDives)
      ? requestedCheckpoint
      : "departure";
  const manifest = completeManifests.find((entry) => entry.checkpoint === checkpoint);
  if (!manifest) notFound();
  const rollCallComplete = manifest.summary.totalDivers > 0 && manifest.summary.awaiting === 0;
  const banner = notice ? BANNERS[notice] : undefined;
  const back = `/shop/${shopSlug}/trips/${tripId}/manifest?checkpoint=${checkpoint}`;

  async function rollCallAction(formData: FormData) {
    "use server";
    const staff = await requireStaffSession();
    const parsed = rollCallSchema.safeParse(Object.fromEntries(formData));
    if (!parsed.success) redirect(`${back}&notice=error`);
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
      redirect(`${back}&notice=${outcome.reason === "not_ready" ? "not-ready" : "error"}`);
    }
    revalidatePath(back.split("?")[0]);
    redirect(`${back}&notice=${parsed.data.status === "boarded" ? "boarded" : "not-boarded"}`);
  }

  return (
    <main className="boat-mode mx-auto w-full max-w-4xl flex-1 px-6 py-12 print:max-w-none print:px-0 print:py-0">
      <a
        href="#roll-call-list"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-lg focus:bg-primary focus:px-4 focus:py-3 focus:text-primary-foreground"
      >
        Skip to roll call
      </a>
      <FlashParams params={["notice"]} />
      <RestorePreservedScroll />
      <div className="print:hidden">
        <Link
          href={`/shop/${shopSlug}/trips/${tripId}`}
          className="text-sm font-medium text-primary hover:underline"
        >
          ← Back to trip
        </Link>
      </div>
      <header className="mt-4 flex flex-wrap items-start justify-between gap-5 border-b border-border pb-7 print:mt-0">
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

      {banner ? (
        <p
          role="status"
          className={
            banner.tone === "success"
              ? "mt-6 rounded-lg bg-success/10 px-4 py-3 text-sm font-medium text-success print:hidden"
              : "mt-6 rounded-lg bg-danger/10 px-4 py-3 text-sm font-medium text-danger print:hidden"
          }
        >
          {banner.text}
        </p>
      ) : null}

      <section className="mt-7 grid grid-cols-2 gap-3 sm:grid-cols-5">
        {[
          ["Divers", manifest.summary.totalDivers],
          ["Ready", manifest.summary.ready],
          ["Blocked", manifest.summary.blocked],
          ["Boarded", manifest.summary.boarded],
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
                ? "min-h-11 shrink-0 rounded-lg bg-primary px-4 py-2.5 font-semibold text-primary-foreground"
                : "min-h-11 shrink-0 rounded-lg border border-border-strong px-4 py-2.5 font-semibold hover:bg-surface-sunken"
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
            const boarded = diver.rollCall?.state === "boarded";
            return (
              <li
                key={diver.bookingId}
                id={`roll-call-${diver.bookingId}`}
                className={
                  ready
                    ? diver.rollCall
                      ? "border-l-4 border-success px-4 py-5 sm:px-5"
                      : "border-l-4 border-warning bg-warning/10 px-4 py-5 ring-1 ring-inset ring-warning/30 sm:px-5"
                    : "scroll-mt-32 border-l-4 border-danger bg-danger/5 px-4 py-5 sm:px-5"
                }
              >
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
                      <span className="rounded-full bg-surface-sunken px-3 py-1 text-sm font-medium">
                        {rollCallLabel(diver.rollCall)}
                      </span>
                    </div>
                    <div className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
                      <p>
                        <span className="font-bold">Emergency contact</span>
                        <span className="mt-0.5 block text-muted">
                          {diver.emergencyContactName ?? "Not on file"}
                          {diver.emergencyContactPhone ? ` · ${diver.emergencyContactPhone}` : ""}
                        </span>
                      </p>
                      <p>
                        <span className="font-bold">Gear</span>
                        <span className="mt-0.5 block text-muted">
                          {diver.gear.length > 0
                            ? diver.gear.map((item) => item.label).join(", ")
                            : "None assigned"}
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
                      <div className="mt-2">
                        <label
                          htmlFor={`roll-call-note-${diver.bookingId}`}
                          className="text-sm font-semibold"
                        >
                          Optional note
                        </label>
                        <input
                          id={`roll-call-note-${diver.bookingId}`}
                          name="note"
                          form={`not-boarded-${diver.bookingId}`}
                          maxLength={300}
                          placeholder="Late to the boat, medical question, gear issue…"
                          className="mt-1 min-h-11 w-full rounded-lg border border-border-strong bg-surface px-3 py-2 text-base"
                        />
                        <p className="mt-1 text-xs text-muted">
                          This is saved with the staff audit trail.
                        </p>
                      </div>
                    </details>
                    {diver.rollCall ? (
                      <p className="mt-3 text-sm text-muted">
                        {rollCallLabel(diver.rollCall)}{" "}
                        {formatDateTimeTz(diver.rollCall.occurredAt, "en-US", shop.timezone)} by{" "}
                        {diver.rollCall.recordedByName}
                        {diver.rollCall.note ? ` · ${diver.rollCall.note}` : ""}
                      </p>
                    ) : null}
                  </div>
                  <div className="flex w-full shrink-0 flex-col gap-2 print:hidden sm:w-auto sm:flex-row sm:flex-wrap">
                    {ready ? (
                      <ScrollPreservingForm action={rollCallAction}>
                        <input type="hidden" name="bookingId" value={diver.bookingId} />
                        <input type="hidden" name="status" value="boarded" />
                        <SubmitButton
                          pendingLabel="Saving…"
                          className="min-h-14 w-full touch-manipulation rounded-lg bg-primary px-5 text-base font-semibold text-primary-foreground transition-[transform,opacity] hover:bg-primary-hover active:scale-[0.99] disabled:cursor-wait disabled:opacity-70 sm:w-auto"
                        >
                          {boarded ? "Boarded ✓" : "Mark boarded"}
                        </SubmitButton>
                      </ScrollPreservingForm>
                    ) : null}
                    <ScrollPreservingForm
                      id={`not-boarded-${diver.bookingId}`}
                      action={rollCallAction}
                    >
                      <input type="hidden" name="bookingId" value={diver.bookingId} />
                      <input type="hidden" name="status" value="not_boarded" />
                      <SubmitButton
                        pendingLabel="Saving…"
                        className="min-h-14 w-full touch-manipulation rounded-lg border border-border px-5 text-base font-semibold transition-[transform,opacity] hover:bg-surface-sunken active:scale-[0.99] disabled:cursor-wait disabled:opacity-70 sm:w-auto"
                      >
                        {diver.rollCall?.state === "not_boarded"
                          ? "Not boarded ✓"
                          : "Mark not boarded"}
                      </SubmitButton>
                    </ScrollPreservingForm>
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
