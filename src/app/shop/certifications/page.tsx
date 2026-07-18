import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { z } from "zod";
import { FlashParams } from "@/components/FlashParams";
import { getDb } from "@/db/client";
import { getShopById } from "@/db/queries";
import {
  createCertification,
  listShopCertifications,
  listShopDivers,
  reviewCertification,
} from "@/db/readiness";
import { CERTIFICATION_LEVEL_LABELS } from "@/lib/readiness";
import { requireStaffSession } from "@/lib/session";

export const metadata: Metadata = {
  title: "Certifications — Scuba",
};

const agencySchema = z.enum(["padi", "ssi", "naui", "sdi", "tdi", "other"]);
const levelSchema = z.enum([
  "open_water",
  "advanced_open_water",
  "rescue",
  "divemaster",
  "instructor",
]);
const certificationSchema = z.object({
  personId: z.string().uuid(),
  agency: agencySchema,
  level: levelSchema,
  identifier: z.string().trim().min(2).max(120),
  expiresOn: z.union([z.literal(""), z.string().regex(/^\d{4}-\d{2}-\d{2}$/)]),
  cardImageUrl: z.union([z.literal(""), z.url().max(2_000)]),
});

const AGENCY_LABELS: Record<z.infer<typeof agencySchema>, string> = {
  padi: "PADI",
  ssi: "SSI",
  naui: "NAUI",
  sdi: "SDI",
  tdi: "TDI",
  other: "Other agency",
};

export default async function CertificationsPage({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string }>;
}) {
  const session = await requireStaffSession();
  const { notice } = await searchParams;
  const db = await getDb();
  const shop = await getShopById(db, session.user.shopId);
  if (!shop) return null;
  const [divers, certificationRows] = await Promise.all([
    listShopDivers(db, shop.id),
    listShopCertifications(db, shop.id),
  ]);

  async function addCertificationAction(formData: FormData) {
    "use server";
    const staff = await requireStaffSession();
    const parsed = certificationSchema.safeParse(Object.fromEntries(formData));
    if (!parsed.success) redirect("/shop/certifications?notice=invalid");
    const expiresAt = parsed.data.expiresOn
      ? new Date(`${parsed.data.expiresOn}T23:59:59.999Z`)
      : undefined;
    const certification = await createCertification(await getDb(), {
      shopId: staff.user.shopId,
      personId: parsed.data.personId,
      agency: parsed.data.agency,
      level: parsed.data.level,
      identifier: parsed.data.identifier,
      expiresAt,
      cardImageUrl: parsed.data.cardImageUrl || undefined,
    });
    redirect(`/shop/certifications?notice=${certification ? "captured" : "invalid"}`);
  }

  async function reviewAction(formData: FormData) {
    "use server";
    const staff = await requireStaffSession();
    const certificationId = String(formData.get("certificationId") ?? "");
    const status = formData.get("status") === "rejected" ? "rejected" : "verified";
    const updated = certificationId
      ? await reviewCertification(await getDb(), {
          shopId: staff.user.shopId,
          certificationId,
          status,
        })
      : null;
    redirect(`/shop/certifications?notice=${updated ? status : "invalid"}`);
  }

  const banner =
    notice === "captured"
      ? "Card captured as pending. Verify it before it can make a diver ready."
      : notice === "verified"
        ? "Certification verified."
        : notice === "rejected"
          ? "Certification marked for correction."
          : notice === "invalid"
            ? "That certification could not be saved. Check the diver and card details."
            : undefined;

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-16">
      <FlashParams params={["notice"]} />
      <Link href="/shop" className="text-sm font-medium text-primary hover:underline">
        ← Back to the shop
      </Link>
      <header className="mt-4">
        <p className="text-sm font-medium tracking-widest text-primary uppercase">{shop.name}</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">Certifications</h1>
        <p className="mt-2 text-muted">
          Capture card evidence, then explicitly verify it before the readiness service can clear a
          diver.
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
        <h2 className="text-lg font-semibold">Capture a card</h2>
        {divers.length === 0 ? (
          <p className="mt-4 rounded-lg border border-border bg-surface p-4 text-sm text-muted">
            Divers appear here after they book a trip.
          </p>
        ) : (
          <form
            action={addCertificationAction}
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
              Level
              <select
                name="level"
                className="min-h-11 rounded-lg border border-border-strong bg-surface px-3 text-base font-normal"
              >
                {Object.entries(CERTIFICATION_LEVEL_LABELS).map(([value, label]) => (
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
            <label className="flex flex-col gap-1 text-sm font-medium">
              Expiry <span className="font-normal text-muted">(if issued)</span>
              <input
                name="expiresOn"
                type="date"
                className="min-h-11 rounded-lg border border-border-strong bg-surface px-3 py-2 text-base font-normal"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm font-medium sm:col-span-2">
              Card image URL{" "}
              <span className="font-normal text-muted">(optional secure reference)</span>
              <input
                name="cardImageUrl"
                type="url"
                maxLength={2000}
                placeholder="https://…"
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
        <h2 className="text-lg font-semibold">Cards on file</h2>
        {certificationRows.length === 0 ? (
          <p className="mt-4 text-sm text-muted">No certification cards are on file yet.</p>
        ) : (
          <ul className="mt-4 divide-y divide-border rounded-lg border border-border bg-surface">
            {certificationRows.map(({ certification, person }) => {
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
                      {person.fullName} · {AGENCY_LABELS[certification.agency]}{" "}
                      {CERTIFICATION_LEVEL_LABELS[certification.level]}
                    </p>
                    <p className="mt-1 text-sm text-muted">
                      {certification.identifier}
                      {certification.expiresAt
                        ? ` · expires ${certification.expiresAt.toLocaleDateString("en-US")}`
                        : ""}
                    </p>
                    {certification.cardImageUrl ? (
                      <a
                        href={certification.cardImageUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-1 inline-block text-sm font-medium text-primary hover:underline"
                      >
                        View card reference
                      </a>
                    ) : null}
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
    </main>
  );
}
