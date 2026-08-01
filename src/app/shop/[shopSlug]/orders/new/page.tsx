import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { z } from "zod";
import { FlashParams } from "@/components/FlashParams";
import { ShopPageHeader } from "@/components/ShopPageHeader";
import { StaffNoticeBanner } from "@/components/StaffNoticeBanner";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { controlClass, Field, FieldGrid } from "@/components/ui/form";
import { getDb } from "@/db/client";
import { createOrder, getBookingContext, listOrderableCustomers } from "@/db/orders";
import { orderLineItemKind } from "@/db/schema";
import { getShopById } from "@/db/shops";
import { canAcceptPayments, getShopCurrency, getShopStripeAccount } from "@/db/stripe-accounts";
import { requestLocale } from "@/i18n/request";
import { type StaffMessageKey, staffTranslator } from "@/i18n/staff-messages";
import { bookingInvoiceLines } from "@/lib/courses";
import { formatShortDate } from "@/lib/format";
import { currencyFractionDigits, majorToMinor, minorToMajor, toShopCurrency } from "@/lib/money";
import { revalidateAndRedirect } from "@/lib/navigation";
import { requireStaffSession } from "@/lib/session";
import { noticeFromParam } from "@/lib/staff-notices";

export const metadata: Metadata = { title: "New order — DiveDay" };

const LINE_ITEM_KINDS = [
  { value: "trip_fee", key: "orders.new.kind.trip_fee" },
  { value: "course_fee", key: "orders.new.kind.course_fee" },
  { value: "e_learning_fee", key: "orders.new.kind.e_learning_fee" },
  { value: "rental", key: "orders.new.kind.rental" },
  { value: "nitrox", key: "orders.new.kind.nitrox" },
  { value: "deposit", key: "orders.new.kind.deposit" },
  { value: "merchandise", key: "orders.new.kind.merchandise" },
  { value: "other", key: "orders.new.kind.other" },
] as const satisfies { value: string; key: StaffMessageKey }[];

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

  const db = await getDb();
  // Staff type a major-unit price ("129.00"); the invoice is billed in an
  // integer count of the shop currency's minor unit. The multiplier is the
  // currency's own, never a literal 100 — ¥5000 typed is 5000 stored, not
  // 500000 (docs ADR 20260731-shop-currency). `createOrder` reads the same
  // shop setting for the invoice itself, so the two can't disagree.
  const currency = await getShopCurrency(db, session.user.shopId);

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
      unitAmountCents: majorToMinor(dollars.data, currency),
    });
  }

  if (!personId || lineItems.length === 0) {
    redirect(`/shop/${session.user.shopSlug}/orders/new?notice=invalid`);
  }

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

// A notice query param maps to a message key, never to a sentence — the words
// come from the staff bundle at render time (docs ADR 20260730-staff-copy-localization).
const NOTICE_KEYS: Record<string, StaffMessageKey> = {
  invalid: "orders.new.notice.invalid",
  not_connected: "orders.new.notice.notConnected",
  stripe_failed: "orders.new.notice.stripeFailed",
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

  const locale = await requestLocale();
  const t = staffTranslator(locale);
  const noticeKey = noticeFromParam(notice, NOTICE_KEYS);
  const [customers, bookingContext, shop] = await Promise.all([
    listOrderableCustomers(db, session.user.shopId),
    prefillBookingId ? getBookingContext(db, session.user.shopId, prefillBookingId) : null,
    getShopById(db, session.user.shopId),
  ]);

  // Auto-fill from the linked booking so staff only review and send. A course
  // session fills two lines — instruction and e-learning — because a student
  // who already did the e-learning gets that line cleared rather than the
  // total re-worked by hand. Everything else is one trip fee.
  //
  // `bookingInvoiceLines` hands back the *parts* of each line, never a
  // sentence (docs ADR 20260731-domain-layer-copy-leaks): the course/trip title
  // is a shop-authored proper noun, and the words around it come from the staff
  // bundle here. Whatever this composes is what staff can edit and what
  // `createOrder` then freezes onto the invoice.
  const currency = toShopCurrency(shop?.currency);
  // A zero-decimal currency has no ¥1.50 to type — `step="0.01"` invited one,
  // and `majorToMinor` would have rounded it to 2.
  const unitAmountDigits = currencyFractionDigits(currency);
  const unitAmountStep = unitAmountDigits === 0 ? "1" : `0.${"0".repeat(unitAmountDigits - 1)}1`;
  const lineDefaults = (bookingContext ? bookingInvoiceLines(bookingContext) : []).map((line) => ({
    kind: line.kind as LineItemKind,
    description:
      line.kind === "trip_fee"
        ? line.tripTitle
        : t(line.kind === "course_fee" ? "orderLine.instruction" : "orderLine.eLearning", {
            courseTitle: line.courseTitle,
          }),
    unitAmount:
      line.amountCents === null
        ? ""
        : minorToMajor(line.amountCents, currency).toFixed(currencyFractionDigits(currency)),
  }));
  const isCourseOrder = lineDefaults.some((line) => line.kind === "e_learning_fee");

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <FlashParams params={["notice"]} />
      <ShopPageHeader
        eyebrow={t("orders.new.eyebrow")}
        title={t("orders.new.title")}
        actions={
          <Link
            href={
              prefillPersonId
                ? `/shop/${shopSlug}/divers/${prefillPersonId}`
                : `/shop/${shopSlug}/divers`
            }
            className={buttonClass({ variant: "secondary", className: "text-foreground" })}
          >
            {t("orders.new.cancel")}
          </Link>
        }
      />

      {notice ? (
        <StaffNoticeBanner tone="danger">
          {noticeKey ? t(noticeKey) : t("orders.new.notice.fallback")}
        </StaffNoticeBanner>
      ) : null}

      {bookingContext ? (
        <p className="mb-6 rounded-lg border border-border bg-surface-sunken px-4 py-3 text-sm">
          {t("orders.new.linkedTo", {
            personName: bookingContext.person.fullName,
            tripTitle: bookingContext.trip.title,
            date: formatShortDate(bookingContext.trip.startsAt, locale, shop?.timezone),
          })}{" "}
          {isCourseOrder
            ? t("orders.new.courseNote")
            : bookingContext.trip.priceCents === null
              ? t("orders.new.noPriceNote")
              : t("orders.new.priceNote")}
        </p>
      ) : null}

      <form action={createOrderAction} className="flex flex-col gap-6">
        {prefillBookingId ? (
          <input type="hidden" name="bookingId" value={prefillBookingId} />
        ) : null}

        <FieldGrid columns={1} className="gap-y-6">
          <Field label={t("orders.new.customerLabel")}>
            <select
              name="personId"
              required
              defaultValue={prefillPersonId ?? ""}
              className={controlClass}
            >
              <option value="" disabled>
                {t("orders.new.chooseCustomer")}
              </option>
              {customers.map((customer) => (
                <option key={customer.id} value={customer.id}>
                  {customer.fullName}
                  {customer.email ? ` — ${customer.email}` : ""}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t("orders.new.noteLabel")} hint={t("orders.new.noteHint")}>
            <input
              type="text"
              name="description"
              maxLength={200}
              placeholder={t("orders.new.notePlaceholder")}
              className={controlClass}
            />
          </Field>
        </FieldGrid>

        <fieldset className="flex flex-col gap-3">
          <legend className="text-sm font-medium">{t("orders.new.lineItemsLegend")}</legend>
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
                      {t(kind.key)}
                    </option>
                  ))}
                </select>
                <input
                  type="text"
                  name={`description-${i}`}
                  defaultValue={rowDefault?.description}
                  placeholder={t("orders.new.lineItemDescriptionPlaceholder")}
                  maxLength={200}
                  className={controlClass}
                />
                <input
                  type="number"
                  name={`quantity-${i}`}
                  defaultValue={1}
                  min={1}
                  aria-label={t("orders.new.quantityLabel")}
                  className={controlClass}
                />
                <input
                  type="number"
                  name={`unitAmount-${i}`}
                  step={unitAmountStep}
                  min={0}
                  defaultValue={rowDefault?.unitAmount}
                  aria-label={t("orders.new.unitPriceLabel")}
                  placeholder={t("orders.new.unitPricePlaceholder")}
                  className={controlClass}
                />
              </div>
            );
          })}
        </fieldset>

        <SubmitButton
          pendingLabel={t("orders.new.sending")}
          className={buttonClass({ size: "lg", className: "self-start" })}
        >
          {t("orders.new.submit")}
        </SubmitButton>
      </form>
    </main>
  );
}
