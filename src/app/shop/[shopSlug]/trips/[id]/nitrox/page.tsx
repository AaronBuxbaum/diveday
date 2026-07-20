import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { FlashParams } from "@/components/FlashParams";
import { buttonClass } from "@/components/ui/button";
import { controlClass, Field, FieldActions, FieldGrid } from "@/components/ui/form";
import { getDb } from "@/db/client";
import {
  listShopTanks,
  listTripNitroxFills,
  logNitroxFill,
  verifiedNitroxPersonIds,
} from "@/db/nitrox";
import { getShopById, getTripRoster, getTripWithBooked } from "@/db/queries";
import { formatShortDate, formatTimeRangeTz } from "@/lib/format";
import { revalidateAndRedirect } from "@/lib/navigation";
import { nitroxMixLabel, ppO2CentibarToBar } from "@/lib/nitrox";
import { requireStaffSession } from "@/lib/session";

export const metadata: Metadata = {
  title: "Nitrox fills — Scuba",
};

const fillSchema = z.object({
  bookingId: z.string().uuid(),
  gearItemId: z.string().uuid(),
  oxygenPercent: z.coerce.number().int().min(1).max(100),
  maxPpo2: z.enum(["1.4", "1.6"]),
  analyzerSignature: z.string().trim().min(1).max(120),
});

const NOTICES: Record<string, { tone: "success" | "danger"; text: string }> = {
  logged: { tone: "success", text: "Fill logged. The diver's MOD is set from the analyzed mix." },
  diver_not_certified: {
    tone: "danger",
    text: "That diver has no verified nitrox card — record and verify one first.",
  },
  invalid_mix: {
    tone: "danger",
    text: "Enter a recreational EANx mix between 22% and 40% oxygen.",
  },
  analysis_required: {
    tone: "danger",
    text: "The diver must sign that they analyzed the mix themselves.",
  },
  tank_not_found: { tone: "danger", text: "Choose a tank from this shop's inventory." },
  not_a_tank: { tone: "danger", text: "That equipment isn't a tank." },
  tank_retired: { tone: "danger", text: "That tank is retired and can't be filled." },
  booking_unavailable: { tone: "danger", text: "That booking isn't active." },
  invalid: { tone: "danger", text: "Check the mix, tank, and signature, then try again." },
};

export default async function TripNitroxPage({
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
  const trip = await getTripWithBooked(db, shop.id, tripId);
  if (!trip) notFound();
  const [roster, tanks, certified, fills] = await Promise.all([
    getTripRoster(db, tripId),
    listShopTanks(db, shop.id),
    verifiedNitroxPersonIds(db, shop.id),
    listTripNitroxFills(db, shop.id, tripId),
  ]);
  const back = `/shop/${shopSlug}/trips/${tripId}/nitrox`;
  const banner = notice ? NOTICES[notice] : undefined;
  const anyCertified = roster.some(({ person }) => certified.has(person.id));

  async function logFillAction(formData: FormData) {
    "use server";
    const staff = await requireStaffSession();
    const parsed = fillSchema.safeParse(Object.fromEntries(formData));
    if (!parsed.success) redirect(`${back}?notice=invalid`);
    const outcome = await logNitroxFill(await getDb(), {
      shopId: staff.user.shopId,
      bookingId: parsed.data.bookingId,
      gearItemId: parsed.data.gearItemId,
      oxygenPercent: parsed.data.oxygenPercent,
      analyzerSignature: parsed.data.analyzerSignature,
      filledByPersonId: staff.user.personId,
      maxPpO2Bar: Number(parsed.data.maxPpo2),
    });
    revalidateAndRedirect(back, `${back}?notice=${outcome.ok ? "logged" : outcome.reason}`);
  }

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-16">
      <FlashParams params={["notice"]} />
      <Link
        href={`/shop/${shopSlug}/trips/${tripId}`}
        className="text-sm font-medium text-primary hover:underline"
      >
        ← Back to the trip
      </Link>
      <header className="mt-4">
        <p className="text-sm font-medium tracking-widest text-primary uppercase">Nitrox fills</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">{trip.title}</h1>
        <p className="mt-1 text-muted">
          {formatShortDate(trip.startsAt, "en-US", shop.timezone)} ·{" "}
          {formatTimeRangeTz(trip.startsAt, trip.endsAt, "en-US", shop.timezone)}
        </p>
      </header>

      {banner ? (
        <p
          role="status"
          className={`mt-6 rounded-lg px-4 py-3 text-sm font-medium ${banner.tone === "success" ? "bg-success/10 text-success" : "bg-danger/10 text-danger"}`}
        >
          {banner.text}
        </p>
      ) : null}

      <section className="mt-10">
        <h2 className="text-lg font-semibold">Log an analyzed fill</h2>
        {tanks.length === 0 ? (
          <p className="mt-4 rounded-lg border border-border bg-surface p-4 text-sm text-muted">
            No tanks in inventory yet. Add tanks on the{" "}
            <Link
              href={`/shop/${shopSlug}/gear`}
              className="font-medium text-primary hover:underline"
            >
              gear page
            </Link>{" "}
            first.
          </p>
        ) : roster.length === 0 ? (
          <p className="mt-4 rounded-lg border border-border bg-surface p-4 text-sm text-muted">
            No divers booked yet.
          </p>
        ) : (
          <FieldGrid
            columns={2}
            as="form"
            action={logFillAction}
            className="mt-4 rounded-lg border border-border bg-surface p-5"
          >
            <Field label="Diver" className="sm:col-span-2">
              <select name="bookingId" required className={controlClass}>
                <option value="">Choose a diver</option>
                {roster.map(({ booking, person }) => {
                  const ok = certified.has(person.id);
                  return (
                    <option key={booking.id} value={booking.id} disabled={!ok}>
                      {person.fullName}
                      {ok ? "" : " · no verified nitrox card"}
                    </option>
                  );
                })}
              </select>
              {anyCertified ? null : (
                <span className="text-xs text-warning">
                  No booked diver has a verified nitrox card yet. Record one on the{" "}
                  <Link href={`/shop/${shopSlug}/nitrox`} className="font-medium underline">
                    nitrox page
                  </Link>
                  .
                </span>
              )}
            </Field>
            <Field label="Tank">
              <select name="gearItemId" required className={controlClass}>
                <option value="">Choose a tank</option>
                {tanks.map((tank) => (
                  <option key={tank.id} value={tank.id}>
                    {tank.label}
                    {tank.size ? ` · ${tank.size}` : ""}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Oxygen %" hint="(analyzed, 22–40)">
              <input
                name="oxygenPercent"
                type="number"
                required
                min={22}
                max={40}
                defaultValue={32}
                className={`${controlClass} tabular-nums`}
              />
            </Field>
            <Field label="ppO₂ ceiling">
              <select name="maxPpo2" className={controlClass} defaultValue="1.4">
                <option value="1.4">1.4 bar (working)</option>
                <option value="1.6">1.6 bar (contingency)</option>
              </select>
            </Field>
            <Field label="Diver's analysis signature">
              <input
                name="analyzerSignature"
                type="text"
                required
                maxLength={120}
                placeholder="Diver types their name"
                className={controlClass}
              />
            </Field>
            <FieldActions>
              <button type="submit" className={buttonClass({ size: "lg" })}>
                Log fill
              </button>
            </FieldActions>
          </FieldGrid>
        )}
      </section>

      <section className="mt-12 border-t border-border pt-8">
        <h2 className="text-lg font-semibold">Fills on this trip</h2>
        {fills.length === 0 ? (
          <p className="mt-4 text-sm text-muted">No fills logged for this trip yet.</p>
        ) : (
          <ul className="mt-4 divide-y divide-border rounded-lg border border-border bg-surface">
            {fills.map(({ fill, person, tank }) => (
              <li
                key={fill.id}
                className="flex items-center justify-between gap-3 px-4 py-3 text-sm"
              >
                <div className="min-w-0">
                  <p className="font-medium">
                    {person.fullName} · {nitroxMixLabel(fill.oxygenPercent)}
                  </p>
                  <p className="text-muted">
                    {tank.label} · analyzed {formatShortDate(fill.analyzedAt, "en-US")} · signed “
                    {fill.analyzerSignature}”
                  </p>
                </div>
                <span className="shrink-0 rounded-full bg-primary/10 px-3 py-1 font-medium text-primary tabular-nums">
                  MOD {fill.maxDepthMeters} m @ ppO₂ {ppO2CentibarToBar(fill.maxPpO2Centibar)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
