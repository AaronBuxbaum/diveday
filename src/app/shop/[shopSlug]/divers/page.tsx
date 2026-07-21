import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { z } from "zod";
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
import { DiverList } from "./_components/DiverList";

export const metadata: Metadata = { title: "Divers — DiveDay" };

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
  searchParams: Promise<{ notice?: string; deleted?: string; q?: string; after?: string }>;
}) {
  const session = await requireStaffSession();
  const { shopSlug } = await params;
  const { notice, deleted, q, after } = await searchParams;
  const db = await getDb();
  const shop = await getShopById(db, session.user.shopId);
  if (!shop) return null;
  const query = q?.trim() ?? "";
  const diverPage = await listDiverSummaries(db, shop.id, { query, cursor: after });

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
            {query ? `${diverPage.total} matching` : `${diverPage.total} on file`}
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

      <DiverList page={diverPage} shopSlug={shopSlug} query={query} cursorActive={Boolean(after)} />
    </main>
  );
}
