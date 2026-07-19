import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { z } from "zod";
import { FlashParams } from "@/components/FlashParams";
import { getDb } from "@/db/client";
import { createDiver, listDiverSummaries } from "@/db/divers";
import { getShopById } from "@/db/queries";
import { requireStaffSession } from "@/lib/session";

export const metadata: Metadata = { title: "Divers — Scuba" };

const diverSchema = z.object({
  fullName: z.string().trim().min(2).max(120),
  email: z.union([z.literal(""), z.email().max(320)]),
  phone: z.string().trim().max(40),
});

export default async function DiversPage({
  params,
  searchParams,
}: {
  params: Promise<{ shopSlug: string }>;
  searchParams: Promise<{ notice?: string }>;
}) {
  const session = await requireStaffSession();
  const { shopSlug } = await params;
  const { notice } = await searchParams;
  const db = await getDb();
  const shop = await getShopById(db, session.user.shopId);
  if (!shop) return null;
  const divers = await listDiverSummaries(db, shop.id);

  async function addDiverAction(formData: FormData) {
    "use server";
    const staff = await requireStaffSession();
    const parsed = diverSchema.safeParse(Object.fromEntries(formData));
    if (!parsed.success) redirect(`/shop/${staff.user.shopSlug}/divers?notice=invalid`);
    const diver = await createDiver(await getDb(), {
      shopId: staff.user.shopId,
      fullName: parsed.data.fullName,
      email: parsed.data.email,
      phone: parsed.data.phone,
    });
    redirect(
      diver
        ? `/shop/${staff.user.shopSlug}/divers/${diver.id}`
        : `/shop/${staff.user.shopSlug}/divers?notice=duplicate`,
    );
  }

  const noticeText =
    notice === "duplicate"
      ? "A diver with that email is already in this shop."
      : notice === "invalid"
        ? "Check the diver's name, email, and phone number."
        : null;

  return (
    <main className="mx-auto w-full max-w-4xl flex-1 px-6 py-16">
      <FlashParams params={["notice"]} />
      <Link href={`/shop/${shopSlug}`} className="text-sm font-medium text-primary hover:underline">
        ← Back to the shop
      </Link>
      <header className="mt-4 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm font-medium tracking-widest text-primary uppercase">{shop.name}</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">Divers</h1>
          <p className="mt-2 max-w-2xl text-muted">
            Start with the person. Their cards, rental fit, bookings, and issued gear live together
            so the front desk always has the right context.
          </p>
        </div>
        <span className="text-sm text-muted">{divers.length} on file</span>
      </header>

      {noticeText ? (
        <p role="status" className="mt-6 rounded-lg bg-danger/10 px-4 py-3 text-sm text-danger">
          {noticeText}
        </p>
      ) : null}

      <details className="mt-8 rounded-lg border border-border bg-surface p-5">
        <summary className="cursor-pointer font-semibold">Add a diver</summary>
        <p className="mt-2 text-sm text-muted">
          Add a returning diver before they book, then fill in the details you already have.
        </p>
        <form action={addDiverAction} className="mt-4 grid gap-4 sm:grid-cols-3">
          <label className="flex flex-col gap-1 text-sm font-medium">
            Full name
            <input
              name="fullName"
              required
              className="min-h-11 rounded-lg border border-border-strong bg-surface px-3 text-base font-normal"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium">
            Email <span className="font-normal text-muted">(optional)</span>
            <input
              name="email"
              type="email"
              className="min-h-11 rounded-lg border border-border-strong bg-surface px-3 text-base font-normal"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium">
            Phone <span className="font-normal text-muted">(optional)</span>
            <input
              name="phone"
              type="tel"
              className="min-h-11 rounded-lg border border-border-strong bg-surface px-3 text-base font-normal"
            />
          </label>
          <button
            type="submit"
            className="min-h-11 rounded-lg bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition-colors duration-200 hover:bg-primary-hover sm:col-span-3 sm:justify-self-start"
          >
            Add diver
          </button>
        </form>
      </details>

      <section className="mt-10" aria-labelledby="diver-list-heading">
        <h2 id="diver-list-heading" className="text-lg font-semibold">
          People
        </h2>
        {divers.length === 0 ? (
          <div className="mt-4 rounded-lg border border-border bg-surface p-8 text-center">
            <p className="font-medium">No divers on file yet.</p>
            <p className="mt-1 text-sm text-muted">
              Add one here or accept a booking to create their person record.
            </p>
          </div>
        ) : (
          <ul className="mt-4 grid gap-3 sm:grid-cols-2">
            {divers.map((diver) => {
              const pending = diver.pendingCertificationCount + diver.pendingSpecialtyCount;
              return (
                <li key={diver.person.id}>
                  <Link
                    href={`/shop/${shopSlug}/divers/${diver.person.id}`}
                    className="block rounded-lg border border-border bg-surface p-5 transition-colors duration-200 hover:border-primary/50 hover:bg-surface-sunken"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h3 className="truncate font-semibold">{diver.person.fullName}</h3>
                        <p className="mt-1 truncate text-sm text-muted">
                          {diver.person.email ?? diver.person.phone ?? "No contact details yet"}
                        </p>
                      </div>
                      <span className="shrink-0 text-primary" aria-hidden="true">
                        →
                      </span>
                    </div>
                    <div className="mt-5 flex flex-wrap gap-2 text-sm">
                      <span className="rounded-full bg-primary/10 px-3 py-1 text-primary">
                        {diver.certificationCount + diver.specialtyCount} card
                        {diver.certificationCount + diver.specialtyCount === 1 ? "" : "s"}
                      </span>
                      <span className="rounded-full bg-surface-sunken px-3 py-1 text-muted">
                        {diver.gearProfile ? "Fit saved" : "No fit profile"}
                      </span>
                      {diver.assignedGearCount > 0 ? (
                        <span className="rounded-full bg-warning/10 px-3 py-1 text-warning">
                          {diver.assignedGearCount} gear checked out
                        </span>
                      ) : null}
                      {pending > 0 ? (
                        <span className="rounded-full bg-warning/10 px-3 py-1 text-warning">
                          {pending} pending review
                        </span>
                      ) : null}
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </main>
  );
}
