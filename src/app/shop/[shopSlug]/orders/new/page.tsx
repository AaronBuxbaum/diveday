import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { z } from "zod";
import { FlashParams } from "@/components/FlashParams";
import { ShopNotice, ShopPageHeader } from "@/components/ShopPageHeader";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { controlClass, Field, FieldGrid } from "@/components/ui/form";
import { getDb } from "@/db/client";
import { createOrder, getBookingContext, listOrderableCustomers } from "@/db/orders";
import { orderLineItemKind } from "@/db/schema";
import { getShopById } from "@/db/shops";
import { canAcceptPayments, getShopStripeAccount } from "@/db/stripe-accounts";
import { bookingInvoiceLines } from "@/lib/courses";
import { formatShortDate } from "@/lib/format";
import { revalidateAndRedirect } from "@/lib/navigation";
import { requireStaffSession } from "@/lib/session";

export const metadata: Metadata = { title: "New order — DiveDay" };

const LINE_ITEM_KINDS = [
  { value: "trip_fee", label: "Trip fee" },
  { value: "course_fee", label: "Course fee" },
  { value: "e_learning_fee", label: "e-Learning" },
  { value: "rental", label: "Rental" },
  { value: "nitrox", label: "Nitrox (per dive)" },
  { value: "deposit", label: "Deposit" },
  { value: "merchandise", label: "Merchandise" },
  { value: "other", label: "Other" },
] as const;

const LINE_ITEM_ROWS = 4;

type LineItemKind = (typeof LINE_ITEM_KINDS)[number]["value"];

// Bounds match the house convention for a bounded dollar-to-cents amount
// (courses edit action: .max(100_000)) and an explicit integer quantity
// range (trip capacity/party-size actions: .int().min().max()) — CR-016.
const dollarsSchema = z.coerce.number().nonnegative().max(100_000);
const quantitySchema = z.coerce.number().int().min(1).max(100);
const lineDescriptionSchema = z.string().trim().min(1).max(200);
// Sourced from the pg enum, not a hand-typed literal list, so it can never
// drift from what the database will actually accept.
const lineItemKindSchema = z.enum(orderLineItemKind.enumValues);

async function createOrderAction(formData: FormData) {
  "use server";
  const session = await requireStaffSession();
  const personId = String(formData.get("personId") ?? "");
  const bookingId = String(formData.get("bookingId") ?? "").trim() || null;
  const description = String(formData.get("description") ?? "").trim() || null;

  const lineItems: {
    kind: LineItemKind;
    description: string;
    quantity: number;
    unitAmountCents: number;
  }[] = [];
  for (let i = 0; i < LINE_ITEM_ROWS; i++) {
    const rawDescription = String(formData.get(`description-${i}`) ?? "").trim();
    if (!rawDescription) continue;
    const itemDescription = lineDescriptionSchema.safeParse(rawDescription);
    const kind = lineItemKindSchema.safeParse(formData.get(`kind-${i}`));
    const quantity = quantitySchema.safeParse(formData.get(`quantity-${i}`) ?? "1");
    const dollars = dollarsSchema.safeParse(formData.get(`unitAmount-${i}`));
    // A filled-in row with an out-of-bounds value fails the whole submission
    // rather than silently dropping the row — a staff member who typed four
    // line items should never end up with a three-line invoice unexplained.
    if (!itemDescription.success || !kind.success || !quantity.success || !dollars.success) {
      redirect(`/shop/${session.user.shopSlug}/orders/new?notice=invalid`);
    }
    lineItems.push({
      kind: kind.data,
      description: itemDescription.data,
      quantity: quantity.data,
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
  revalidateAndRedirect(
    `/shop/${session.user.shopSlug}/orders`,
    `/shop/${session.user.shopSlug}/orders/${result.order.id}`,
  );
}

const NOTICE_MESSAGES: Record<string, string> = {
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

  // Auto-fill from the linked booking so staff only review and send. A course
  // session fills two lines — instruction and e-learning — because a student
  // who already did the e-learning gets that line cleared rather than the
  // total re-worked by hand. Everything else is one trip fee.
  const lineDefaults = (bookingContext ? bookingInvoiceLines(bookingContext) : []).map((line) => ({
    kind: line.kind as LineItemKind,
    description: line.description,
    unitAmount: line.amountCents === null ? "" : (line.amountCents / 100).toFixed(2),
  }));
  const isCourseOrder = lineDefaults.some((line) => line.kind === "e_learning_fee");

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <FlashParams params={["notice"]} />
      <ShopPageHeader
        eyebrow="Front desk"
        title="New order"
        actions={
          <Link
            href={
              prefillPersonId
                ? `/shop/${shopSlug}/divers/${prefillPersonId}`
                : `/shop/${shopSlug}/divers`
            }
            className={buttonClass({ variant: "secondary", className: "text-foreground" })}
          >
            Cancel
          </Link>
        }
      />

      {notice ? (
        <div className="mb-6">
          <ShopNotice tone="danger" role="alert">
            {NOTICE_MESSAGES[notice] ?? "That order couldn't be created."}
          </ShopNotice>
        </div>
      ) : null}

      {bookingContext ? (
        <p className="mb-6 rounded-lg border border-border bg-surface-sunken px-4 py-3 text-sm">
          Linked to {bookingContext.person.fullName}'s booking on {bookingContext.trip.title} (
          {formatShortDate(bookingContext.trip.startsAt, "en-US", shop?.timezone)}).{" "}
          {isCourseOrder
            ? "The course's instruction and e-learning lines are pre-filled from your catalog. One invoice, two lines: clear the e-learning line if this student already completed it elsewhere."
            : bookingContext.trip.priceCents === null
              ? "This trip has no price set, so the trip fee below is blank — add one on the trip page to skip this step next time."
              : "The trip fee below is pre-filled from this trip's price."}
        </p>
      ) : null}

      <form action={createOrderAction} className="flex flex-col gap-6">
        {prefillBookingId ? (
          <input type="hidden" name="bookingId" value={prefillBookingId} />
        ) : null}

        <FieldGrid columns={1} className="gap-y-6">
          <Field label="Customer">
            <select
              name="personId"
              required
              defaultValue={prefillPersonId ?? ""}
              className={controlClass}
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
          </Field>
          <Field label="Order note" hint="(optional)">
            <input
              type="text"
              name="description"
              maxLength={200}
              placeholder="e.g. Two-tank reef charter + rental set"
              className={controlClass}
            />
          </Field>
        </FieldGrid>

        <fieldset className="flex flex-col gap-3">
          <legend className="text-sm font-medium">Line items</legend>
          {Array.from({ length: LINE_ITEM_ROWS }).map((_, i) => {
            const rowDefault = lineDefaults[i] ?? null;
            return (
              <div
                // biome-ignore lint/suspicious/noArrayIndexKey: a fixed set of static rows, never reordered
                key={i}
                className="grid grid-cols-1 gap-2 rounded-lg border border-border p-3 sm:grid-cols-[7rem_1fr_5rem_6rem]"
              >
                <select
                  name={`kind-${i}`}
                  defaultValue={rowDefault?.kind ?? "other"}
                  className={controlClass}
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
                  className={controlClass}
                />
                <input
                  type="number"
                  name={`quantity-${i}`}
                  defaultValue={1}
                  min={1}
                  aria-label="Quantity"
                  className={controlClass}
                />
                <input
                  type="number"
                  name={`unitAmount-${i}`}
                  step="0.01"
                  min={0}
                  defaultValue={rowDefault?.unitAmount}
                  aria-label="Unit price (USD)"
                  placeholder="$0.00"
                  className={controlClass}
                />
              </div>
            );
          })}
        </fieldset>

        <SubmitButton
          pendingLabel="Sending…"
          className={buttonClass({ size: "lg", className: "self-start" })}
        >
          Create and send invoice
        </SubmitButton>
      </form>
    </main>
  );
}
