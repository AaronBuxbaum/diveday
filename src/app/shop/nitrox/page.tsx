import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { z } from "zod";
import { FlashParams } from "@/components/FlashParams";
import { getDb } from "@/db/client";
import {
  createNitroxCertification,
  listShopNitroxCertifications,
  listShopNitroxFills,
  reviewNitroxCertification,
} from "@/db/nitrox";
import { getShopById } from "@/db/queries";
import { listShopDivers } from "@/db/readiness";
import { formatShortDate } from "@/lib/format";
import { nitroxMixLabel, ppO2CentibarToBar } from "@/lib/nitrox";
import { requireStaffSession } from "@/lib/session";

export const metadata: Metadata = {
  title: "Nitrox — Scuba",
};

const agencySchema = z.enum(["padi", "ssi", "naui", "sdi", "tdi", "other"]);
const AGENCY_LABELS: Record<z.infer<typeof agencySchema>, string> = {
  padi: "PADI",
  ssi: "SSI",
  naui: "NAUI",
  sdi: "SDI",
  tdi: "TDI",
  other: "Other agency",
};

const nitroxCardSchema = z.object({
  personId: z.string().uuid(),
  agency: agencySchema,
  identifier: z.string().trim().min(2).max(120),
});

export default async function NitroxPage({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string }>;
}) {
  const session = await requireStaffSession();
  const { notice } = await searchParams;
  const db = await getDb();
  const shop = await getShopById(db, session.user.shopId);
  if (!shop) return null;
  const [divers, cards, fills] = await Promise.all([
    listShopDivers(db, shop.id),
    listShopNitroxCertifications(db, shop.id),
    listShopNitroxFills(db, shop.id),
  ]);

  async function addCardAction(formData: FormData) {
    "use server";
    const staff = await requireStaffSession();
    const parsed = nitroxCardSchema.safeParse(Object.fromEntries(formData));
    if (!parsed.success) redirect("/shop/nitrox?notice=invalid");
    const card = await createNitroxCertification(await getDb(), {
      shopId: staff.user.shopId,
      personId: parsed.data.personId,
      agency: parsed.data.agency,
      identifier: parsed.data.identifier,
    });
    redirect(`/shop/nitrox?notice=${card ? "captured" : "invalid"}`);
  }

  async function reviewAction(formData: FormData) {
    "use server";
    const staff = await requireStaffSession();
    const certificationId = String(formData.get("certificationId") ?? "");
    const status = formData.get("status") === "rejected" ? "rejected" : "verified";
    const updated = certificationId
      ? await reviewNitroxCertification(await getDb(), {
          shopId: staff.user.shopId,
          certificationId,
          status,
        })
      : null;
    redirect(`/shop/nitrox?notice=${updated ? status : "invalid"}`);
  }

  const banner =
    notice === "captured"
      ? "Nitrox card captured as pending. Verify it before this diver can take an EANx fill."
      : notice === "verified"
        ? "Nitrox card verified."
        : notice === "rejected"
          ? "Nitrox card marked for correction."
          : notice === "invalid"
            ? "That nitrox card could not be saved. Check the diver and card details."
            : undefined;

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-16">
      <FlashParams params={["notice"]} />
      <Link href="/shop" className="text-sm font-medium text-primary hover:underline">
        ← Back to the shop
      </Link>
      <header className="mt-4">
        <p className="text-sm font-medium tracking-widest text-primary uppercase">{shop.name}</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">Nitrox</h1>
        <p className="mt-2 text-muted">
          Track enriched-air specialty cards, then log analyzed fills from each trip. Only a
          verified card can take an EANx tank.
        </p>
      </header>

      {banner ? (
        <p
          role="status"
          className={`mt-6 rounded-lg px-4 py-3 text-sm font-medium ${notice === "invalid" ? "bg-danger/10 text-danger" : "bg-success/10 text-success"}`}
        >
          {banner}
        </p>
      ) : null}

      <section className="mt-10">
        <h2 className="text-lg font-semibold">Record a nitrox card</h2>
        {divers.length === 0 ? (
          <p className="mt-4 rounded-lg border border-border bg-surface p-4 text-sm text-muted">
            Divers appear here after they book a trip.
          </p>
        ) : (
          <form
            action={addCardAction}
            className="mt-4 grid grid-cols-1 gap-4 rounded-lg border border-border bg-surface p-5 sm:grid-cols-2"
          >
            <label className="flex flex-col gap-1 text-sm font-medium sm:col-span-2">
              Diver
              <select
                name="personId"
                required
                className="min-h-11 rounded-lg border border-border-strong bg-surface px-3 text-base font-normal"
              >
                <option value="">Choose a diver</option>
                {divers.map((diver) => (
                  <option key={diver.id} value={diver.id}>
                    {diver.fullName}
                    {diver.email ? ` · ${diver.email}` : ""}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm font-medium">
              Agency
              <select
                name="agency"
                className="min-h-11 rounded-lg border border-border-strong bg-surface px-3 text-base font-normal"
              >
                {Object.entries(AGENCY_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm font-medium">
              Card number
              <input
                name="identifier"
                required
                maxLength={120}
                className="min-h-11 rounded-lg border border-border-strong bg-surface px-3 py-2 text-base font-normal"
              />
            </label>
            <div className="sm:col-span-2">
              <button
                type="submit"
                className="min-h-11 rounded-lg bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition-colors duration-200 hover:bg-primary-hover"
              >
                Capture for review
              </button>
            </div>
          </form>
        )}
      </section>

      <section className="mt-12 border-t border-border pt-8">
        <h2 className="text-lg font-semibold">Nitrox cards on file</h2>
        {cards.length === 0 ? (
          <p className="mt-4 text-sm text-muted">No nitrox cards are on file yet.</p>
        ) : (
          <ul className="mt-4 divide-y divide-border rounded-lg border border-border bg-surface">
            {cards.map(({ certification, person }) => {
              const tone =
                certification.status === "verified"
                  ? "bg-success/10 text-success"
                  : certification.status === "rejected"
                    ? "bg-danger/10 text-danger"
                    : "bg-warning/10 text-warning";
              return (
                <li
                  key={certification.id}
                  className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div>
                    <p className="font-medium">
                      {person.fullName} · {AGENCY_LABELS[certification.agency]} Enriched Air
                    </p>
                    <p className="mt-1 text-sm text-muted">{certification.identifier}</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`rounded-full px-3 py-1 text-sm font-medium ${tone}`}>
                      {certification.status}
                    </span>
                    {certification.status === "pending" ? (
                      <>
                        <form action={reviewAction}>
                          <input type="hidden" name="certificationId" value={certification.id} />
                          <input type="hidden" name="status" value="verified" />
                          <button
                            type="submit"
                            className="min-h-11 rounded-lg border border-border bg-surface px-3 text-sm font-medium hover:bg-surface-sunken"
                          >
                            Verify
                          </button>
                        </form>
                        <form action={reviewAction}>
                          <input type="hidden" name="certificationId" value={certification.id} />
                          <input type="hidden" name="status" value="rejected" />
                          <button
                            type="submit"
                            className="min-h-11 rounded-lg px-3 text-sm font-medium text-danger hover:bg-danger/10"
                          >
                            Needs correction
                          </button>
                        </form>
                      </>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="mt-12 border-t border-border pt-8">
        <h2 className="text-lg font-semibold">Recent fills</h2>
        {fills.length === 0 ? (
          <p className="mt-4 text-sm text-muted">
            No fills logged yet. Open a trip and log an analyzed fill from its nitrox page.
          </p>
        ) : (
          <ul className="mt-4 divide-y divide-border rounded-lg border border-border bg-surface">
            {fills.map(({ fill, person, tank, trip }) => (
              <li
                key={fill.id}
                className="flex items-center justify-between gap-3 px-4 py-3 text-sm"
              >
                <div className="min-w-0">
                  <p className="font-medium">
                    {person.fullName} · {nitroxMixLabel(fill.oxygenPercent)}
                  </p>
                  <p className="text-muted">
                    {tank.label} · {trip.title} · {formatShortDate(fill.analyzedAt, "en-US")}
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
