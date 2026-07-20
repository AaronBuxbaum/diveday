import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { z } from "zod";
import { EmptyState } from "@/components/EmptyState";
import { FlashParams } from "@/components/FlashParams";
import { ShopNotice, ShopPageHeader } from "@/components/ShopPageHeader";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { controlClass, Field, FieldActions, FieldGrid } from "@/components/ui/form";
import { getDb } from "@/db/client";
import { createDiver, listDiverSummaries, restoreDiver } from "@/db/divers";
import { getShopById } from "@/db/shops";
import { revalidateAndRedirect } from "@/lib/navigation";
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
  searchParams: Promise<{ notice?: string; q?: string; deleted?: string }>;
}) {
  const session = await requireStaffSession();
  const { shopSlug } = await params;
  const { notice, q, deleted } = await searchParams;
  const db = await getDb();
  const shop = await getShopById(db, session.user.shopId);
  if (!shop) return null;
  const divers = await listDiverSummaries(db, shop.id);
  const query = q?.trim() ?? "";
  const visibleDivers = query
    ? divers.filter((diver) =>
        [diver.person.fullName, diver.person.email, diver.person.phone]
          .filter(Boolean)
          .some((value) => value?.toLowerCase().includes(query.toLowerCase())),
      )
    : divers;

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
    revalidateAndRedirect(
      `/shop/${staff.user.shopSlug}/divers`,
      diver
        ? `/shop/${staff.user.shopSlug}/divers/${diver.id}`
        : `/shop/${staff.user.shopSlug}/divers?notice=duplicate`,
    );
  }

  async function restoreDiverAction(formData: FormData) {
    "use server";
    const staff = await requireStaffSession();
    const personId = String(formData.get("personId") ?? "");
    const restored = personId && (await restoreDiver(await getDb(), staff.user.shopId, personId));
    revalidateAndRedirect(
      `/shop/${staff.user.shopSlug}/divers`,
      `/shop/${staff.user.shopSlug}/divers?notice=${restored ? "restored" : "invalid"}`,
    );
  }

  const noticeText =
    notice === "duplicate"
      ? "A diver with that email is already in this shop."
      : notice === "deleted"
        ? "Diver removed. Their history is preserved, but they no longer appear in active work."
        : notice === "restored"
          ? "Diver restored to active shop work."
          : notice === "invalid"
            ? "Check the diver's name, email, and phone number."
            : null;
  const noticeIsError = notice === "duplicate" || notice === "invalid";

  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <FlashParams params={["notice"]} />
      <ShopPageHeader
        eyebrow={shop.name}
        title="Divers"
        description="Start with the person. Their cards, rental fit, and bookings stay together so the front desk always has the right context."
        meta={
          <span className="text-sm text-muted">
            {query
              ? `${visibleDivers.length} of ${divers.length} shown`
              : `${divers.length} on file`}
          </span>
        }
      />

      {noticeText ? (
        <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
          <ShopNotice tone={noticeIsError ? "danger" : "success"}>
            <p role="status">{noticeText}</p>
          </ShopNotice>
          {notice === "deleted" && deleted ? (
            <form action={restoreDiverAction}>
              <input type="hidden" name="personId" value={deleted} />
              <SubmitButton
                pendingLabel="Restoring…"
                className={buttonClass({
                  variant: "secondary",
                  size: "sm",
                  className: "border-success/30 text-success",
                })}
              >
                Undo remove
              </SubmitButton>
            </form>
          ) : null}
        </div>
      ) : null}

      <details className="mt-8 rounded-2xl border border-border bg-surface p-5 shadow-sm">
        <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between font-semibold [&::-webkit-details-marker]:hidden">
          Add a diver{" "}
          <span aria-hidden="true" className="text-xl font-normal text-primary">
            +
          </span>
        </summary>
        <p className="mt-2 text-sm text-muted">
          Add a returning diver before they book, then fill in the details you already have.
        </p>
        <FieldGrid columns={3} className="mt-4" as="form" action={addDiverAction}>
          <Field label="Full name">
            <input name="fullName" required autoComplete="name" className={controlClass} />
          </Field>
          <Field label="Email" hint="(optional)">
            <input name="email" type="email" autoComplete="email" className={controlClass} />
          </Field>
          <Field label="Phone" hint="(optional)">
            <input name="phone" type="tel" autoComplete="tel" className={controlClass} />
          </Field>
          <FieldActions>
            <SubmitButton pendingLabel="Adding…" className={buttonClass({ size: "lg" })}>
              Add diver
            </SubmitButton>
          </FieldActions>
        </FieldGrid>
      </details>

      <section className="mt-10" aria-labelledby="diver-list-heading">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 id="diver-list-heading" className="text-lg font-semibold">
              People
            </h2>
            <p className="mt-1 text-sm text-muted">Search by name, email, or phone.</p>
          </div>
          <form method="get" className="flex w-full gap-2 sm:w-80">
            <label className="sr-only" htmlFor="diver-search">
              Search divers
            </label>
            <input
              id="diver-search"
              name="q"
              defaultValue={query}
              placeholder="Search people"
              className={`${controlClass} min-w-0 flex-1`}
            />
            <button type="submit" className={buttonClass({ variant: "secondary" })}>
              Search
            </button>
          </form>
        </div>
        {visibleDivers.length === 0 ? (
          <EmptyState className="mt-4">
            <p className="font-medium">
              {query ? "No matching divers." : "No divers on file yet."}
            </p>
            <p className="mt-1 text-sm text-muted">
              {query
                ? "Try a different search or add a new diver above."
                : "Add one here or accept a booking to create their person record."}
            </p>
          </EmptyState>
        ) : (
          <div className="relative mt-4 overflow-x-auto rounded-2xl border border-border bg-surface shadow-sm">
            <table className="w-full min-w-180 border-collapse text-left">
              <thead className="bg-surface-sunken text-xs tracking-wider text-muted uppercase">
                <tr>
                  <th scope="col" className="px-4 py-3 font-medium">
                    Person
                  </th>
                  <th scope="col" className="px-4 py-3 font-medium">
                    Cards
                  </th>
                  <th scope="col" className="px-4 py-3 font-medium">
                    Rental fit
                  </th>
                  <th scope="col" className="px-4 py-3 font-medium">
                    Attention
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {visibleDivers.map((diver) => {
                  const pending = diver.pendingCertificationCount + diver.pendingSpecialtyCount;
                  return (
                    <tr
                      key={diver.person.id}
                      className="group relative transition-colors duration-200 hover:bg-surface-sunken"
                    >
                      <td className="relative px-4 py-3">
                        {/*
                         * The name and avatar are the row's only link: its ::after
                         * covers the whole cell so a tap anywhere on the person
                         * lands on them, without a second link repeating the row
                         * for screen readers.
                         */}
                        <Link
                          href={`/shop/${shopSlug}/divers/${diver.person.id}`}
                          className="flex min-w-0 items-center gap-3 after:absolute after:inset-0 after:rounded-xl focus-visible:outline-none focus-visible:after:outline-2 focus-visible:after:outline-offset-[-2px] focus-visible:after:outline-primary"
                        >
                          <span
                            className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary/10 font-semibold text-primary"
                            aria-hidden="true"
                          >
                            {diver.person.fullName
                              .split(" ")
                              .map((part) => part[0])
                              .join("")
                              .slice(0, 2)
                              .toUpperCase()}
                          </span>
                          <div className="min-w-0">
                            <p className="truncate font-semibold group-hover:text-primary">
                              {diver.person.fullName}
                              <span
                                aria-hidden="true"
                                className="ml-1 opacity-0 transition-opacity group-hover:opacity-100"
                              >
                                →
                              </span>
                            </p>
                            <p className="truncate text-sm font-normal text-muted">
                              {diver.person.email ?? diver.person.phone ?? "No contact details yet"}
                            </p>
                          </div>
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-sm">
                        <span className="inline-flex whitespace-nowrap rounded-full bg-primary/10 px-3 py-1 text-primary">
                          {diver.certificationCount +
                            diver.specialtyCount +
                            diver.nitroxCertificationCount}{" "}
                          card
                          {diver.certificationCount +
                            diver.specialtyCount +
                            diver.nitroxCertificationCount ===
                          1
                            ? ""
                            : "s"}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm text-muted">
                        {diver.rentalFit ? "Fit saved" : "No fit on file"}
                      </td>
                      <td className="px-4 py-3 text-sm">
                        <div className="flex flex-wrap gap-2">
                          {pending > 0 ? (
                            <span className="rounded-full bg-warning/10 px-3 py-1 text-warning">
                              {pending} pending review
                            </span>
                          ) : null}
                          {pending === 0 ? <span className="text-muted">None</span> : null}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}
