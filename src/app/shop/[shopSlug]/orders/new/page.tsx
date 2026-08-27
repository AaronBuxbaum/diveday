import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { FlashParams } from "@/components/FlashParams";
import { ShopPageHeader } from "@/components/ShopPageHeader";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { SectionCard } from "@/components/ui/card";
import { controlClass, Field, FieldGrid, FormStatus } from "@/components/ui/form";
import { canPersonManageOrders } from "@/db/authz";
import { getBookingContext, listOrderableCustomers } from "@/db/orders";
import { canAcceptPayments, getShopStripeAccount } from "@/db/stripe-accounts";
import { requestLocale } from "@/i18n/request";
import { type StaffMessageKey, staffTranslator } from "@/i18n/staff-messages";
import { bookingInvoiceLines } from "@/lib/courses";
import { formatShortDate } from "@/lib/format";
import { currencyFractionDigits, minorToMajor, toShopCurrency } from "@/lib/money";
import { requireShopSurface } from "@/lib/session";
import { noticeFromParam, noticeUrl, shopPath } from "@/lib/staff-notices";
import { uuidParam } from "@/lib/uuid";
import { createOrderAction } from "./actions";
import { LINE_ITEM_ROWS } from "./order-form";

// `instant = true` asserts that navigating *into* this page paints
// immediately. It is not a claim that the route has a static shell: the staff
// shell layout declares `instant = false` (read its comment for why), so a
// cold, direct visit still blocks on the session and the shop row. What this
// validates is the navigation staff actually make all day — arriving from
// another `/shop` page, where that shell is already mounted and this
// segment's `loading.tsx` is what paints. See ADR 20260804-instant-navigation.
export const instant = true;

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

type LineItemKind = (typeof LINE_ITEM_KINDS)[number]["value"];

// A notice query param maps to a message key, never to a sentence — the words
// come from the staff bundle at render time (docs ADR 20260730-staff-copy-localization).
const NOTICE_KEYS: Record<string, StaffMessageKey> = {
  invalid: "orders.new.notice.invalid",
  "not-connected": "orders.new.notice.notConnected",
  "tax-location-required": "orders.new.notice.taxLocationRequired",
  "stripe-failed": "orders.new.notice.stripeFailed",
};

export default async function NewOrderPage({
  params,
  searchParams,
}: {
  params: Promise<{ shopSlug: string }>;
  searchParams: Promise<{ notice?: string; personId?: string; bookingId?: string }>;
}) {
  const { shopSlug } = await params;
  const { notice, personId, bookingId } = await searchParams;
  // Both ids arrive from a link another page built (a diver record, a roster
  // row), and a link is the thing that gets truncated in a chat message.
  // `bookings.id` is a `uuid` column: handed a stray string,
  // `getBookingContext` does not come back empty — it throws `invalid input
  // syntax for type uuid` and 500s the page. `personId` never reaches a query
  // here, but it is written straight into this page's own links back to
  // `/divers/<id>`, so it is guarded too rather than handed on to a page that
  // *does* look it up. A malformed id is simply not a prefill — the staffer
  // gets the blank order form they can still use.
  const prefillPersonId = uuidParam(personId);
  const prefillBookingId = uuidParam(bookingId);
  // Billing a diver is owner/manager work (H-14, ADR 20260724-role-authorization),
  // like the refund on the order it becomes and the discount codes that set what
  // a trip costs. The whole page is that one concern, so for anyone else it isn't
  // a surface — but the landing is the Orders index with the reason rather than
  // Today, because a captain can still *read* orders: the door is closed, not the
  // room. `createOrderAction` re-checks; this only saves a wasted round trip.
  const { session, db, shop } = await requireShopSurface(shopSlug, {
    allow: canPersonManageOrders,
    refusal: { notice: "not-authorized", landing: ["orders"] },
  });

  // The gate, not a courtesy: the entry links hide themselves when the shop
  // can't accept payments, but this page refuses regardless of how it was
  // reached. Both landings carry a notice code the destination handles — a
  // refusal that teleports you somewhere silently reads as a broken button
  // (task 82). With a diver in hand we go back to their record; without one,
  // the Orders index, which is the surface this door belongs to. Never
  // `/divers`, which has nothing to say about payments.
  //
  // One code, `payment-not-connected`, on both branches. These two lines used
  // to spell it two different ways — kebab for the diver record, snake for the
  // Orders index — because the two destination maps had been written by
  // different hands, so the `/orders` branch landed on a page whose map had no
  // matching key and rendered no banner at all (src/lib/staff-notices.ts's
  // `NOTICE_CODE_PATTERN`, enforced by scripts/check-notice-codes.mjs).
  const account = await getShopStripeAccount(db, session.user.shopId);
  if (!canAcceptPayments(account)) {
    redirect(
      noticeUrl(
        prefillPersonId
          ? shopPath(shopSlug, "divers", prefillPersonId)
          : shopPath(shopSlug, "orders"),
        "payment-not-connected",
      ),
    );
  }

  const locale = await requestLocale();
  const t = staffTranslator(locale);
  const noticeKey = noticeFromParam(notice, NOTICE_KEYS);
  /**
   * The billing address the tax fieldset below opens with — **only on a demo
   * shop**, and only its own address. See the note beside that fieldset for why
   * a real shop is deliberately left to type it.
   */
  const demoAddress = shop.isDemo ? shop : null;
  const [customers, bookingContext] = await Promise.all([
    listOrderableCustomers(db, shop.id),
    prefillBookingId ? getBookingContext(db, shop.id, prefillBookingId) : null,
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
  const currency = toShopCurrency(shop.currency);
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
            className={buttonClass({ variant: "secondary" })}
          >
            {t("orders.new.cancel")}
          </Link>
        }
      />

      {bookingContext ? (
        <p className="mb-6 rounded-lg border border-border bg-surface-sunken px-4 py-3 text-sm">
          {t("orders.new.linkedTo", {
            personName: bookingContext.person.fullName,
            tripTitle: bookingContext.trip.title,
            date: formatShortDate(bookingContext.trip.startsAt, locale, shop?.timezone),
          })}{" "}
          {!isCourseOrder && bookingContext.trip.priceCents === null
            ? t("orders.new.noPriceNote")
            : null}
        </p>
      ) : null}

      <SectionCard padding="lg" className="mt-8">
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

          {/* **The demo shop's form arrives filled in.**
              Turning Stripe Tax on makes these six fields required, and a demo
              is meant to be walked through rather than typed into — so the
              canonical demo prefills them with its own address, which for the
              counter sale this form mostly raises is also the honest answer to
              "where did this sale happen?".

              `isDemo` only. On a real shop this is a *customer's* billing
              address and Stripe Tax calculates from it, so defaulting it to the
              shop's own would quietly compute the wrong jurisdiction's tax on
              every invoice — a worse failure than an empty field, because it
              looks answered. A real shop still types it. */}
          {shop.taxEnabled ? (
            <fieldset className="rounded-lg border border-border p-4">
              <legend className="px-1 text-sm font-medium">
                {t("orders.new.taxLocationLegend")}
              </legend>
              <p className="mt-1 text-sm text-muted">{t("orders.new.taxLocationHint")}</p>
              <FieldGrid columns={2} className="mt-4">
                <Field label={t("orders.new.addressLine1")} className="sm:col-span-2">
                  <input
                    type="text"
                    name="customerAddressLine1"
                    defaultValue={demoAddress?.addressStreet ?? ""}
                    required
                    autoComplete="billing address-line1"
                    maxLength={200}
                    className={controlClass}
                  />
                </Field>
                <Field label={t("orders.new.addressLine2")} hint={t("orders.new.noteHint")}>
                  <input
                    type="text"
                    name="customerAddressLine2"
                    autoComplete="billing address-line2"
                    maxLength={200}
                    className={controlClass}
                  />
                </Field>
                <Field label={t("orders.new.city")}>
                  <input
                    type="text"
                    name="customerAddressCity"
                    defaultValue={demoAddress?.addressLocality ?? ""}
                    required
                    autoComplete="billing address-level2"
                    maxLength={100}
                    className={controlClass}
                  />
                </Field>
                <Field label={t("orders.new.region")} hint={t("orders.new.noteHint")}>
                  <input
                    type="text"
                    name="customerAddressRegion"
                    defaultValue={demoAddress?.addressRegion ?? ""}
                    autoComplete="billing address-level1"
                    maxLength={100}
                    className={controlClass}
                  />
                </Field>
                <Field label={t("orders.new.postalCode")}>
                  <input
                    type="text"
                    name="customerAddressPostalCode"
                    defaultValue={demoAddress?.addressPostalCode ?? ""}
                    required
                    autoComplete="billing postal-code"
                    maxLength={30}
                    className={controlClass}
                  />
                </Field>
                <Field label={t("orders.new.country")}>
                  <input
                    type="text"
                    name="customerAddressCountry"
                    defaultValue={demoAddress?.addressCountry ?? ""}
                    required
                    autoComplete="billing country"
                    maxLength={2}
                    pattern="[A-Za-z]{2}"
                    placeholder={t("orders.new.countryPlaceholder")}
                    className={`${controlClass} uppercase`}
                  />
                </Field>
              </FieldGrid>
            </fieldset>
          ) : null}

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
                    // The `<legend>` names the fieldset, not this row's control,
                    // so each picker states which line it belongs to — four
                    // identically-labelled "Kind" selects would be no more use to
                    // a screen reader than none at all (WCAG 4.1.2).
                    aria-label={t("orders.new.lineItemKindAria", { number: i + 1 })}
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

          <div className="flex flex-wrap items-center gap-3">
            <SubmitButton
              pendingLabel={t("orders.new.sending")}
              className={buttonClass({ size: "lg" })}
            >
              {t("orders.new.submit")}
            </SubmitButton>
            {/* Why the order was refused, beside the button that tried to send
              it — the invoice form is long enough that a banner under the
              heading is off screen by the time anyone presses Send. */}
            <FormStatus tone="danger">
              {notice ? (noticeKey ? t(noticeKey) : t("orders.new.notice.fallback")) : undefined}
            </FormStatus>
          </div>
        </form>
      </SectionCard>
    </main>
  );
}
