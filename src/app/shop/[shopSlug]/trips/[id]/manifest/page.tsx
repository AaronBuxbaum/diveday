import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { FlashParams } from "@/components/FlashParams";
import { PrintButton } from "@/components/PrintButton";
import { getDb } from "@/db/client";
import { getTripManifest, recordRollCall } from "@/db/manifests";
import { getShopById } from "@/db/queries";
import { formatDateTimeTz, formatShortDate, formatTimeRangeTz } from "@/lib/format";
import { rollCallLabel } from "@/lib/manifests";
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
  searchParams: Promise<{ notice?: string }>;
}) {
  const session = await requireStaffSession();
  const { shopSlug, id: tripId } = await params;
  const { notice } = await searchParams;
  const db = await getDb();
  const shop = await getShopById(db, session.user.shopId);
  if (!shop) notFound();
  const manifest = await getTripManifest(db, shop.id, tripId);
  if (!manifest) notFound();
  const banner = notice ? BANNERS[notice] : undefined;
  const back = `/shop/${shopSlug}/trips/${tripId}/manifest`;

  async function rollCallAction(formData: FormData) {
    "use server";
    const staff = await requireStaffSession();
    const parsed = rollCallSchema.safeParse(Object.fromEntries(formData));
    if (!parsed.success) redirect(`${back}?notice=error`);
    const outcome = await recordRollCall(await getDb(), {
      shopId: staff.user.shopId,
      tripId,
      bookingId: parsed.data.bookingId,
      recordedByPersonId: staff.user.personId,
      status: parsed.data.status,
      note: parsed.data.note,
    });
    if (!outcome.ok) {
      redirect(`${back}?notice=${outcome.reason === "not_ready" ? "not-ready" : "error"}`);
    }
    redirect(`${back}?notice=${parsed.data.status === "boarded" ? "boarded" : "not-boarded"}`);
  }

  return (
    <main className="mx-auto w-full max-w-4xl flex-1 px-6 py-12 print:max-w-none print:px-0 print:py-0">
      <FlashParams params={["notice"]} />
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
            Live manifest · online
          </span>
          <PrintButton />
        </div>
      </header>
      <p className="mt-3 text-sm text-muted print:hidden">
        This is a live view. Offline snapshots and reconciliation are not enabled yet; refresh
        before departure if the connection changes.
      </p>

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

      <section className="mt-9">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">Roll call</h2>
            <p className="mt-1 text-sm text-muted">
              Check each diver here before departure. Every change is time-stamped with the staff
              member who made it.
            </p>
          </div>
          <p className="text-sm text-muted">Shop time: {shop.timezone}</p>
        </div>
        <ul className="mt-4 divide-y divide-border rounded-lg border border-border bg-surface">
          {manifest.divers.map((diver) => {
            const ready = diver.readiness.status === "ready";
            const boarded = diver.rollCall?.state === "boarded";
            return (
              <li key={diver.bookingId} className="px-4 py-5">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
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
                    <p className="mt-2 text-sm text-muted">
                      Emergency contact: {diver.emergencyContactName ?? "not on file"}
                      {diver.emergencyContactPhone ? ` · ${diver.emergencyContactPhone}` : ""}
                    </p>
                    <p className="mt-1 text-sm text-muted">
                      Gear:{" "}
                      {diver.gear.length > 0
                        ? diver.gear.map((item) => item.label).join(", ")
                        : "none assigned"}
                    </p>
                    {!ready ? (
                      <ul className="mt-3 flex flex-col gap-1 text-sm text-danger">
                        {diver.readiness.blockers.map((blocker) => (
                          <li key={blocker.message}>• {blocker.message}</li>
                        ))}
                      </ul>
                    ) : null}
                    {diver.rollCall ? (
                      <p className="mt-3 text-sm text-muted">
                        {rollCallLabel(diver.rollCall)}{" "}
                        {formatDateTimeTz(diver.rollCall.occurredAt, "en-US", shop.timezone)} by{" "}
                        {diver.rollCall.recordedByName}
                        {diver.rollCall.note ? ` · ${diver.rollCall.note}` : ""}
                      </p>
                    ) : null}
                  </div>
                  <div className="flex shrink-0 flex-wrap gap-2 print:hidden">
                    {ready && !boarded ? (
                      <form action={rollCallAction}>
                        <input type="hidden" name="bookingId" value={diver.bookingId} />
                        <input type="hidden" name="status" value="boarded" />
                        <button
                          type="submit"
                          className="min-h-14 rounded-lg bg-primary px-5 text-base font-semibold text-primary-foreground hover:bg-primary-hover"
                        >
                          Mark boarded
                        </button>
                      </form>
                    ) : null}
                    {!boarded ? (
                      <form action={rollCallAction}>
                        <input type="hidden" name="bookingId" value={diver.bookingId} />
                        <input type="hidden" name="status" value="not_boarded" />
                        <button
                          type="submit"
                          className="min-h-14 rounded-lg border border-border px-5 text-base font-semibold hover:bg-surface-sunken"
                        >
                          Mark not boarded
                        </button>
                      </form>
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
