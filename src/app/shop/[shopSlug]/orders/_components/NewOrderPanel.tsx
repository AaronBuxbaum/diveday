import { AddPanel } from "@/components/AddPanel";
import { keptTypedScope } from "@/components/kept-typed-scope";
import { controlClass, Field, FieldGrid } from "@/components/ui/form";
import { getOrderNewPage } from "@/db/order-new-page";
import type { StaffMessageKey, StaffTranslator } from "@/i18n/staff-messages";
import { addPanelCloseHref, addPanelHref, addPanelOpen } from "@/lib/add-panel";
import { bookingInvoiceLines } from "@/lib/courses";
import { formatShortDate } from "@/lib/format";
import { currencyFractionDigits, minorToMajor, toShopCurrency } from "@/lib/money";
import type { ShopSurface } from "@/lib/session";
import { noticeFromParam, shopPath } from "@/lib/staff-notices";
import { uuidParam } from "@/lib/uuid";
import { invoiceTargetKey } from "../_lib/order-form";
import { createOrderAction } from "../create-order-actions";
import { InvoiceAddressFields } from "./InvoiceAddressFields";
import { InvoiceForm } from "./InvoiceForm";
import { OrderEditor } from "./OrderEditor";

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

/** Billing location uses the same inset as the editable invoice rows. */
const INSET_BOX_CLASS = "rounded-lg border border-border p-4";

// A notice query param maps to a message key, never to a sentence — the words
// come from the staff bundle at render time (docs ADR 20260730-staff-copy-localization).
const NOTICE_KEYS: Record<string, StaffMessageKey> = {
  invalid: "orders.new.notice.invalid",
  "not-connected": "orders.new.notice.notConnected",
  "tax-location-required": "orders.new.notice.taxLocationRequired",
  "stripe-failed": "orders.new.notice.stripeFailed",
};

/** What the Orders URL carries into its add panel (`/orders?add=1`). */
export type NewOrderSearch = {
  add?: string;
  notice?: string;
  personId?: string;
  bookingId?: string;
};

/** The panel's own URL key, which closing it drops; `personId` is the index's filter too. */
const NEW_ORDER_KEYS = ["bookingId"] as const;

/**
 * The Orders index's add door. The panel opens for the people who may bill,
 * on a shop that can take payment (`createOrderAction` re-checks both); a link
 * that asked for it otherwise gets the reason in the index's banner rather
 * than a dead form, and nobody is offered a door they cannot use.
 */
export function newOrderDoorFor(
  shopSlug: string,
  add: string | undefined,
  canManageOrders: boolean,
  paymentsConnected: boolean,
): { adding: boolean; refusal?: "not-authorized" | "payment-not-connected"; href: string | null } {
  const asked = addPanelOpen(add);
  const adding = asked && canManageOrders && paymentsConnected;
  const refusal =
    asked && !adding
      ? canManageOrders
        ? ("payment-not-connected" as const)
        : ("not-authorized" as const)
      : undefined;
  const href = canManageOrders && !adding ? addPanelHref(shopPath(shopSlug, "orders")) : null;
  return { adding, refusal, href };
}

type PanelProps = {
  surface: Pick<ShopSurface, "db" | "shop" | "session">;
  shopSlug: string;
  search: NewOrderSearch;
  t: StaffTranslator;
  locale: string;
};

/** The new-order form in the add panel's shell; closed, it reads nothing. */
export function OrdersAddPanel({ open, ...props }: PanelProps & { open: boolean }) {
  return (
    <AddPanel
      open={open}
      title={props.t("orders.new.title")}
      closeHref={addPanelCloseHref(
        shopPath(props.shopSlug, "orders"),
        props.search,
        NEW_ORDER_KEYS,
      )}
      closeLabel={props.t("shared.addPanel.close")}
    >
      <NewOrderPanel {...props} />
    </AddPanel>
  );
}

/**
 * **A new order**: the Orders index's add panel. The index decides whether it
 * opens at all (owner/manager, on a shop that can take payment) and says why
 * not when it does not; `createOrderAction` re-checks both.
 *
 * `?personId=` and `?bookingId=` arrive from links other pages built (a diver
 * record, a roster row), and a link is the thing that gets truncated in a chat
 * message. `bookings.id` is a `uuid` column: handed a stray string,
 * `getBookingContext` throws rather than coming back empty, so a malformed id
 * is simply not a prefill and the staffer gets the blank form.
 */
export async function NewOrderPanel({
  surface: { db, shop, session },
  shopSlug,
  search: { notice, personId, bookingId },
  t,
  locale,
}: PanelProps) {
  const prefillPersonId = uuidParam(personId);
  const prefillBookingId = uuidParam(bookingId);
  const target = invoiceTargetKey(prefillBookingId, prefillPersonId);
  const invoiceScope = keptTypedScope(shopSlug, session.user.personId);
  const noticeKey = noticeFromParam(notice, NOTICE_KEYS);
  /**
   * The billing address the tax fieldset below opens with — **only on a demo
   * shop**, and only its own address. See the note beside that fieldset for why
   * a real shop is deliberately left to type it.
   */
  const demoAddress = shop.isDemo ? shop : null;
  // The index opens this panel only for a shop that can take payment; the
  // reader asks again and reads nothing more when it cannot.
  const page = await getOrderNewPage(db, shop.id, prefillBookingId);
  if (!page.acceptsPayments) return null;
  const { customers, bookingContext } = page;

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
    quantity: "1",
    unitAmount:
      line.amountCents === null
        ? ""
        : minorToMajor(line.amountCents, currency).toFixed(currencyFractionDigits(currency)),
  }));
  const isCourseOrder = lineDefaults.some((line) => line.kind === "e_learning_fee");

  return (
    <>
      {bookingContext ? (
        // Not an inset note: a band above the form rather than carved into a
        // field, so a hairline draws its edge against the page
        // and it keeps the 16px inset a bordered sunken band takes
        // (StaffPreviewBar, BookingRequestCards).
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

      <InvoiceForm
        identity={`${invoiceScope}:${target}`}
        aria-label={t("orders.new.title")}
        action={createOrderAction}
        className="flex flex-col gap-6"
      >
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

        {shop.taxEnabled ? (
          <InvoiceAddressFields t={t} demoAddress={demoAddress} className={INSET_BOX_CLASS} />
        ) : null}

        <OrderEditor
          defaults={lineDefaults}
          bookingId={prefillBookingId ?? null}
          target={target}
          kinds={LINE_ITEM_KINDS.map((kind) => ({ value: kind.value, label: t(kind.key) }))}
          currency={currency}
          locale={locale}
          step={unitAmountStep}
          scope={invoiceScope}
          restore={Boolean(notice)}
          notice={notice ? (noticeKey ? t(noticeKey) : t("orders.new.notice.fallback")) : undefined}
          words={{
            legend: t("orders.new.lineItemsLegend"),
            item: t("orders.new.lineItemGroup", { number: "#" }),
            kind: t("orders.new.lineItemKindLabel"),
            description: t("orders.new.lineItemDescriptionLabel"),
            descriptionPlaceholder: t("orders.new.lineItemDescriptionPlaceholder"),
            quantity: t("orders.new.quantityLabel"),
            unitPrice: t("orders.new.unitPriceLabel", { currency: currency.toUpperCase() }),
            add: t("orders.new.addItem"),
            remove: t("orders.new.removeItem"),
            removeAria: t("orders.new.removeItemAria", { number: "#" }),
            subtotal: t("orders.new.subtotal"),
            submit: t("orders.new.submit"),
            sending: t("words.busy.sending"),
          }}
        />
      </InvoiceForm>
    </>
  );
}
