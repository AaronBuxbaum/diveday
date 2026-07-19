import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getDb } from "@/db/client";
import { createOrder, getBookingContext, listOrderableCustomers } from "@/db/orders";
import { getShopById } from "@/db/queries";
import { canAcceptPayments, getShopStripeAccount } from "@/db/stripe-accounts";
import { formatShortDate } from "@/lib/format";
import { requireStaffSession } from "@/lib/session";

export const metadata: Metadata = { title: "New order — Scuba" };

const LINE_ITEM_KINDS = [
  { value: "trip_fee", label: "Trip fee" },
  { value: "course_fee", label: "Course fee" },
  { value: "rental_gear", label: "Rental gear" },
  { value: "deposit", label: "Deposit" },
  { value: "merchandise", label: "Merchandise" },
  { value: "other", label: "Other" },
] as const;

const LINE_ITEM_ROWS = 4;

const dollarsSchema = z
  .string()
  .trim()
  .transform((value) => Number(value))
  .pipe(z.number().nonnegative().finite());

async function createOrderAction(formData: FormData) {
  "use server";
  const session = await requireStaffSession();
  const personId = String(formData.get("personId") ?? "");
  const bookingId = String(formData.get("bookingId") ?? "").trim() || null;
  const description = String(formData.get("description") ?? "").trim() || null;

  const lineItems = [];
  for (let i = 0; i < LINE_ITEM_ROWS; i++) {
    const itemDescription = String(formData.get(`description-${i}`) ?? "").trim();
    if (!itemDescription) continue;
    const kind = String(formData.get(`kind-${i}`) ?? "other");
    const quantity = Number(formData.get(`quantity-${i}`) ?? "1") || 1;
    const dollars = dollarsSchema.safeParse(formData.get(`unitAmount-${i}`));
    if (!dollars.success) continue;
    lineItems.push({
      kind: kind as (typeof LINE_ITEM_KINDS)[number]["value"],
      description: itemDescription,
      quantity,
      unitAmountCents: Math.round(dollars.data * 100),
    });
  }

  if (!personId || lineItems.length === 0) {
    redirect(`/shop/${session.user.shopSlug}/orders/new?notice=invalid`);
  }

  const db = await getDb();
  const result = await createOrder(db, {
    shopId: session.user.shopId,
    personId,
    createdByPersonId: session.user.personId,
    bookingId,
    description,
    lineItems,
  });

  if (!result.ok) {
    redirect(`/shop/${session.user.shopSlug}/orders/new?notice=${result.reason}`);
  }
  redirect(`/shop/${session.user.shopSlug}/orders/${result.order.id}`);
}

const NOTICES: Record<string, string> = {
  invalid: "Pick a customer and at least one line item with an amount.",
  not_connected: "Connect a Stripe account in Shop settings before creating an order.",
  stripe_failed: "Stripe couldn't create that invoice. Try again in a moment.",
};

export default async function NewOrderPage({
  params,
  searchParams,
}: {
  params: Promise<{ shopSlug: string }>;
  searchParams: Promise<{ notice?: string; personId?: string; bookingId?: string }>;
}) {
  const session = await requireStaffSession();
  const { shopSlug } = await params;
  const { notice, personId: prefillPersonId, bookingId: prefillBookingId } = await searchParams;
  const db = await getDb();

  const account = await getShopStripeAccount(db, session.user.shopId);
  if (!canAcceptPayments(account)) {
    redirect(
      prefillPersonId
        ? `/shop/${shopSlug}/divers/${prefillPersonId}?notice=payment-not-connected`
        : `/shop/${shopSlug}/divers`,
    );
  }

  const [customers, bookingContext, shop] = await Promise.all([
    listOrderableCustomers(db, session.user.shopId),
    prefillBookingId ? getBookingContext(db, session.user.shopId, prefillBookingId) : null,
    getShopById(db, session.user.shopId),
  ]);

  // Auto-fill the first line item from the linked trip: the fee amount comes
  // straight from the trip's own price, so staff only need to review and send.
  const tripFeeDefault = bookingContext
    ? {
        kind: (bookingContext.trip.courseId ? "course_fee" : "trip_fee") as
          | "trip_fee"
          | "course_fee",
        description: bookingContext.trip.title,
        unitAmount:
          bookingContext.trip.priceCents === null
            ? ""
            : (bookingContext.trip.priceCents / 100).toFixed(2),
      }
    : null;

  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-6 py-16">
      <div className="mb-8 flex items-center justify-between gap-4">
        <div>
          <p className="text-sm font-medium tracking-widest text-primary uppercase">{shopSlug}</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">New order</h1>
        </div>
        <Link
          href={
            prefillPersonId
              ? `/shop/${shopSlug}/divers/${prefillPersonId}`
              : `/shop/${shopSlug}/divers`
          }
          className="rounded-lg border border-border bg-surface px-4 py-2 text-sm font-medium transition-colors duration-200 hover:bg-surface-sunken"
        >
          Cancel
        </Link>
      </div>

      {notice ? (
        <p className="mb-6 rounded-lg bg-danger/10 px-4 py-3 text-sm font-medium text-danger">
          {NOTICES[notice] ?? "That order couldn't be created."}
        </p>
      ) : null}

      {bookingContext ? (
        <p className="mb-6 rounded-lg border border-border bg-surface-sunken px-4 py-3 text-sm">
          Linked to {bookingContext.person.fullName}'s booking on {bookingContext.trip.title} (
          {formatShortDate(bookingContext.trip.startsAt, "en-US", shop?.timezone)}).{" "}
          {bookingContext.trip.priceCents === null
            ? "This trip has no price set, so the trip fee below is blank — add one on the trip page to skip this step next time."
            : "The trip fee below is pre-filled from this trip's price."}
        </p>
      ) : null}

      <form action={createOrderAction} className="flex flex-col gap-6">
        {prefillBookingId ? (
          <input type="hidden" name="bookingId" value={prefillBookingId} />
        ) : null}

        <label className="flex flex-col gap-1 text-sm font-medium">
          Customer
          <select
            name="personId"
            required
            defaultValue={prefillPersonId ?? ""}
            className="min-h-11 rounded-lg border border-border-strong bg-surface px-3 text-sm"
          >
            <option value="" disabled>
              Choose a customer
            </option>
            {customers.map((customer) => (
              <option key={customer.id} value={customer.id}>
                {customer.fullName}
                {customer.email ? ` — ${customer.email}` : ""}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-sm font-medium">
          Order note (optional)
          <input
            type="text"
            name="description"
            maxLength={200}
            placeholder="e.g. Two-tank reef charter + rental set"
            className="min-h-11 rounded-lg border border-border-strong bg-surface px-3 text-sm"
          />
        </label>

        <fieldset className="flex flex-col gap-3">
          <legend className="text-sm font-medium">Line items</legend>
          {Array.from({ length: LINE_ITEM_ROWS }).map((_, i) => {
            const rowDefault = i === 0 ? tripFeeDefault : null;
            return (
              <div
                // biome-ignore lint/suspicious/noArrayIndexKey: a fixed set of static rows, never reordered
                key={i}
                className="grid grid-cols-1 gap-2 rounded-lg border border-border p-3 sm:grid-cols-[7rem_1fr_5rem_6rem]"
              >
                <select
                  name={`kind-${i}`}
                  defaultValue={rowDefault?.kind ?? "other"}
                  className="min-h-11 rounded-lg border border-border-strong bg-surface px-2 text-sm"
                >
                  {LINE_ITEM_KINDS.map((kind) => (
                    <option key={kind.value} value={kind.value}>
                      {kind.label}
                    </option>
                  ))}
                </select>
                <input
                  type="text"
                  name={`description-${i}`}
                  defaultValue={rowDefault?.description}
                  placeholder="Description"
                  maxLength={200}
                  className="min-h-11 rounded-lg border border-border-strong bg-surface px-3 text-sm"
                />
                <input
                  type="number"
                  name={`quantity-${i}`}
                  defaultValue={1}
                  min={1}
                  aria-label="Quantity"
                  className="min-h-11 rounded-lg border border-border-strong bg-surface px-3 text-sm"
                />
                <input
                  type="number"
                  name={`unitAmount-${i}`}
                  step="0.01"
                  min={0}
                  defaultValue={rowDefault?.unitAmount}
                  aria-label="Unit price (USD)"
                  placeholder="$0.00"
                  className="min-h-11 rounded-lg border border-border-strong bg-surface px-3 text-sm"
                />
              </div>
            );
          })}
        </fieldset>

        <button
          type="submit"
          className="min-h-11 self-start rounded-lg bg-primary px-5 py-2 text-sm font-medium text-primary-foreground transition-colors duration-200 hover:bg-primary-hover"
        >
          Create and send invoice
        </button>
      </form>
    </main>
  );
}
