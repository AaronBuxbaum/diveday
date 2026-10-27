"use client";

import {
  type ReactNode,
  useCallback,
  useEffect,
  useEffectEvent,
  useId,
  useRef,
  useState,
} from "react";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { SectionCard } from "@/components/ui/card";
import {
  ChoiceFieldset,
  ChoicePill,
  ChoiceRow,
  controlClass,
  Field,
  FormStatus,
  StickyFormActions,
} from "@/components/ui/form";
import { FIGURE_INLINE_CLASS } from "@/components/ui/typography";
import { isOneCoreSet, o2CleanWarnsForFill } from "@/lib/counter-rentals";
import { formatMoneyCents } from "@/lib/format";
import type { GearItemKind } from "@/lib/gear";
import { currencySymbol, majorToMinor } from "@/lib/money";
import type { NitroxFillMethod } from "@/lib/nitrox-fill";
import {
  CART_CONFIRMED_FIELD,
  CART_FILLS_FIELD,
  CART_PAYMENT_FIELD,
  CART_PRICE_FIELD_PREFIX,
  CART_SET_PRICE_FIELD,
  CART_UNITS_FIELD,
  CONFIRM_FIELD_PREFIX,
  FILL_FIELD_PREFIX,
  KEPT_CART_UNITS_MAX,
  PAYMENT_FIELD,
  PRICE_FIELD_PREFIX,
  type RentalPayment,
  SET_PRICE_FIELD,
  UNIT_FIELD,
} from "../../rental-form";
import { CounterRentalPicker } from "./CounterRentalPicker";
import { counterRentalRowError } from "./counter-rental-row-error";
import { readKeptCart } from "./kept-cart";

export type PickerUnit = {
  id: string;
  kind: GearItemKind;
  label: string;
  size: string | null;
  /** Service words already in the staffer's language (overdue, concern, due soon). */
  care: string[];
  /** Why this unit cannot go to this person, worded; null when it can. */
  blocked: string | null;
  /** A flagged soft-goods unit: lent only with its own "lend anyway" tick. */
  confirmLabel: string | null;
  /** The price box's opening figure in major units, "" when the kind is unpriced. */
  price: string;
  priceAria: string;
  removeAria: string;
  /** A tank's fill menu label; null for every other kind, which takes no fill. */
  fillAria: string | null;
  /**
   * Said under a tank once its gas is EANx, when it has no current O2-clean
   * record (issue #2719); null otherwise. A warning only: the server accepts
   * the fill exactly as before.
   */
  o2CleanWarning: string | null;
};

export type PaymentChoice = { value: RentalPayment; label: string; hint?: string };

export type CartWords = {
  gearHeading: string;
  kindsAria: string;
  filterLabel: string;
  clearFilter: string;
  noMatches: string;
  billHeading: string;
  billEmpty: string;
  inSet: string;
  setLabel: string;
  total: string;
  payHeading: string;
  /** "# item" / "# items", with `#` standing for the count. */
  items: { one: string; other: string };
  submit: string;
  submitting: string;
  review: string;
  /** A tank's gas (#2257): the menu's visible label, its choices, and the card rule. */
  fillLabel: string;
  fillOptions: { value: string; label: string }[];
  fillHint: string;
};

/**
 * A price box a fixed 7rem wide beside its unit's name: the shared control
 * without its `w-full`, which would otherwise win over the width and squeeze
 * the name to one letter a line on a phone.
 */
const PRICE_BOX_CLASS = `${controlClass.replace("w-full", "")} w-28 shrink-0 text-end tabular-nums`;

/** A typed price as minor units; blank or unreadable counts as nothing. */
function centsOf(raw: string, currency: string): number {
  const major = Number(raw);
  return raw.trim() !== "" && Number.isFinite(major) && major >= 0
    ? majorToMinor(major, currency)
    : 0;
}

/** What the page hands Rent out's cart. */
type CounterRentalCartProps = {
  groups: { kind: GearItemKind; kindLabel: string; units: PickerUnit[] }[];
  coreKinds: GearItemKind[];
  /** The set price for these days, in major units, or null when the shop has none. */
  setPrice: string | null;
  currency: string;
  locale: string;
  step: string;
  payments: PaymentChoice[];
  /** A line under the payment choices: why an invoice is not one of them, when it is not. */
  paymentNote: ReactNode;
  invoiceExtras: ReactNode;
  words: CartWords;
  notice: ReactNode;
  /** How the shop fills nitrox (issue 3004): where the O2-clean warning starts. */
  nitroxFillMethod: NitroxFillMethod;
  refusal?: { code: string; unitId: string | null; message: string } | null;
  /**
   * The page came back with this form's refusal: put back the picks, prices
   * and payment this tab just submitted (fifth loop, item 14), so the staffer
   * swaps the one unit that was refused rather than building the bill again.
   * The kept form's scope (`keptTypedScope`) when it did, else null.
   */
  restoreKept?: string | null;
};

/**
 * **Rent out's gear, bill and payment**, as one client island inside the
 * page's form.
 *
 * The page before this one stacked nine kind menus and drew what was picked
 * under the last of them, which on a phone is off the screen: a pick looked
 * like nothing happened (Aaron, 2026-10-09). So a pick now answers where the
 * finger is. The kinds are a row of chips, the free units of the chosen kind
 * are tiles, and a tapped tile turns into a ticked one in place, tapped again
 * to put it back. The bill below the filtered grid keeps every pick with its price, and the
 * sticky bar at the foot says how many and how much the whole time.
 *
 * **What it costs and how it is paid sit on the screen, always** (same day:
 * "it's not totally clear how I charge for it"). Prices open at the shop's
 * own list (`counterRentalLineCents`) and stay editable; a pick that is
 * exactly one core set bills one set line instead. The payment is a required
 * choice, whose options the server decided: cash and card machine are
 * recorded as paid, an invoice goes by email through Stripe, and "no charge"
 * records nothing. `invoiceExtras` (the tax address) shows only for an
 * invoice.
 *
 * The rules are decided on the server and arrive as words (`blocked`,
 * `confirmLabel`); the action re-checks every one of them.
 */
export function CounterRentalCart({
  groups,
  coreKinds,
  setPrice,
  currency,
  locale,
  step,
  payments,
  paymentNote,
  invoiceExtras,
  words,
  notice,
  nitroxFillMethod,
  refusal = null,
  restoreKept = null,
}: CounterRentalCartProps) {
  const billId = useId();
  const reviewRef = useRef<HTMLDivElement>(null);
  const [invoiceAddressInvalid, setInvoiceAddressInvalid] = useState(false);
  const keptAnchor = useRef<HTMLInputElement>(null);
  const [pickedIds, setPickedIds] = useState<readonly string[]>([]);
  const [prices, setPrices] = useState<Record<string, string>>({});
  const [setFigure, setSetFigure] = useState(setPrice ?? "");
  const [payment, setPayment] = useState<RentalPayment | null>(null);
  const [fills, setFills] = useState<Record<string, string>>({});
  const [confirmed, setConfirmed] = useState<readonly string[]>([]);

  const byId = new Map(groups.flatMap((group) => group.units.map((unit) => [unit.id, unit])));

  const restore = useEffectEvent(() => {
    if (!restoreKept) return;
    const kept = readKeptCart(restoreKept, (id) => byId.has(id));
    if (!kept) return;
    setPickedIds(kept.ids);
    setPrices(kept.prices);
    setFills(
      Object.fromEntries(
        Object.entries(kept.fills).map(([id, value]) => [
          id,
          words.fillOptions.some((option) => option.value === value) ? value : "",
        ]),
      ),
    );
    setConfirmed(kept.confirmed);
    if (kept.setFigure !== undefined) setSetFigure(kept.setFigure);
    if (kept.payment) setPayment(kept.payment);
  });
  useEffect(() => {
    if (!restoreKept) return;
    restore();
    const form = keptAnchor.current?.closest("form");
    let frame = 0;
    const onReset = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => restore());
    };
    form?.addEventListener("reset", onReset);
    return () => {
      cancelAnimationFrame(frame);
      form?.removeEventListener("reset", onReset);
    };
  }, [restoreKept]);
  const picked = pickedIds.flatMap((id) => byId.get(id) ?? []);
  const asSet =
    setPrice !== null &&
    isOneCoreSet(
      coreKinds,
      picked.map((unit) => unit.kind),
    );
  const priceOf = (unit: PickerUnit) => prices[unit.id] ?? unit.price;
  const totalCents =
    (asSet ? centsOf(setFigure, currency) : 0) +
    picked
      .filter((unit) => !(asSet && coreKinds.includes(unit.kind)))
      .reduce((sum, unit) => sum + centsOf(priceOf(unit), currency), 0);
  const total = formatMoneyCents(totalCents, currency, locale);
  const symbol = currencySymbol(currency, locale);
  const count = (picked.length === 1 ? words.items.one : words.items.other).replace(
    "#",
    String(picked.length),
  );
  const toggle = (id: string) =>
    setPickedIds((previous) =>
      previous.includes(id) ? previous.filter((other) => other !== id) : [...previous, id],
    );
  const fillOf = (unit: PickerUnit) => fills[unit.id] ?? "";
  // Save the supported cart before per-row fields use up the 80-name draft.
  // Separate price fields let each raw price keep its own value-length budget.
  const keptPicked = picked.slice(0, KEPT_CART_UNITS_MAX);
  const rowError = (unit: PickerUnit) => counterRentalRowError(unit, refusal, fillOf(unit));
  const updateInvoiceAddress = useCallback(() => {
    setInvoiceAddressInvalid(
      Boolean(reviewRef.current?.querySelector('input[name^="customerAddress"]:invalid')),
    );
  }, []);
  useEffect(() => {
    if (payment === "invoice") updateInvoiceAddress();
    else setInvoiceAddressInvalid(false);
  }, [payment, updateInvoiceAddress]);
  const needsPrice = (raw: string) =>
    raw.trim() === "" || !Number.isFinite(Number(raw)) || Number(raw) < 0 || Number(raw) > 100_000;
  const needsReview =
    picked.length > 0 &&
    (!payment ||
      (payment !== "none" &&
        ((asSet && needsPrice(setFigure)) ||
          picked.some(
            (unit) => !(asSet && coreKinds.includes(unit.kind)) && needsPrice(priceOf(unit)),
          ))) ||
      picked.some(
        (unit) =>
          (unit.fillAria && !fillOf(unit)) || (unit.confirmLabel && !confirmed.includes(unit.id)),
      ) ||
      (payment === "invoice" && invoiceAddressInvalid));
  const goToReview = () => {
    const target =
      reviewRef.current?.querySelector<HTMLElement>(
        "input:invalid, select:invalid, textarea:invalid",
      ) ?? reviewRef.current;
    target?.scrollIntoView?.({ block: "center" });
    target?.focus();
  };

  return (
    <>
      <input
        ref={keptAnchor}
        type="hidden"
        name={CART_UNITS_FIELD}
        value={keptPicked.map((unit) => unit.id).join(" ")}
      />
      <input type="hidden" name={CART_PAYMENT_FIELD} value={payment ?? ""} />
      <input type="hidden" name={CART_SET_PRICE_FIELD} value={setFigure} />
      <input
        type="hidden"
        name={CART_FILLS_FIELD}
        value={JSON.stringify(
          Object.fromEntries(
            keptPicked.filter((unit) => unit.fillAria).map((unit) => [unit.id, fillOf(unit)]),
          ),
        )}
      />
      <input
        type="hidden"
        name={CART_CONFIRMED_FIELD}
        value={keptPicked
          .filter((unit) => confirmed.includes(unit.id))
          .map((unit) => unit.id)
          .join(" ")}
      />
      {keptPicked.map((unit) => (
        <input
          key={unit.id}
          type="hidden"
          name={`${CART_PRICE_FIELD_PREFIX}${unit.id}`}
          value={priceOf(unit)}
        />
      ))}
      <CounterRentalPicker groups={groups} pickedIds={pickedIds} toggle={toggle} words={words} />

      <div
        ref={reviewRef}
        id={`${billId}-review`}
        tabIndex={-1}
        className="scroll-mb-32 scroll-mt-24"
        onInput={(event) => {
          if (
            event.target instanceof HTMLInputElement &&
            event.target.name.startsWith("customerAddress")
          )
            updateInvoiceAddress();
        }}
      >
        <SectionCard title={words.billHeading}>
          {picked.length === 0 ? (
            <p className="text-sm text-muted">{words.billEmpty}</p>
          ) : (
            <div className="flex flex-col gap-6">
              <ul aria-label={words.billHeading} id={billId} className="divide-y divide-border">
                {asSet ? (
                  <li className="flex min-h-14 items-center gap-3 py-2">
                    <p className="min-w-0 flex-1 text-sm font-medium">{words.setLabel}</p>
                    <input
                      type="number"
                      name={SET_PRICE_FIELD}
                      required={payment !== null && payment !== "none"}
                      max={payment === "none" ? undefined : 100_000}
                      min={0}
                      step={step}
                      value={setFigure}
                      onChange={(event) => setSetFigure(event.currentTarget.value)}
                      aria-label={words.setLabel}
                      placeholder={symbol}
                      className={PRICE_BOX_CLASS}
                    />
                    <span aria-hidden="true" className="size-11 shrink-0" />
                  </li>
                ) : null}
                {picked.map((unit) => (
                  <CounterRentalPickedItem
                    key={unit.id}
                    unit={unit}
                    inSet={asSet && coreKinds.includes(unit.kind)}
                    price={priceOf(unit)}
                    fill={fillOf(unit)}
                    confirmed={confirmed.includes(unit.id)}
                    hintId={`${billId}-fill-hint`}
                    {...{ payment, symbol, step, words, nitroxFillMethod }}
                    error={rowError(unit)}
                    onPrice={(value) =>
                      setPrices((previous) => ({ ...previous, [unit.id]: value }))
                    }
                    onFill={(value) =>
                      setFills((previous) =>
                        previous[unit.id] === value ? previous : { ...previous, [unit.id]: value },
                      )
                    }
                    onConfirm={(checked) =>
                      setConfirmed((previous) =>
                        checked ? [...previous, unit.id] : previous.filter((id) => id !== unit.id),
                      )
                    }
                    onRemove={() => toggle(unit.id)}
                  />
                ))}
                {picked.some((unit) => unit.fillAria !== null) && (
                  <li id={`${billId}-fill-hint`} className="py-2 text-base text-muted">
                    {words.fillHint}
                  </li>
                )}
                <li className="flex min-h-12 items-center gap-3 pt-3">
                  <p className="flex-1 font-medium">{words.total}</p>
                  <p className={FIGURE_INLINE_CLASS}>{total}</p>
                  <span aria-hidden="true" className="size-11 shrink-0" />
                </li>
              </ul>

              <CounterRentalPayment
                {...{ payment, payments, setPayment, paymentNote, invoiceExtras, words }}
              />
            </div>
          )}
        </SectionCard>
      </div>

      <StickyFormActions>
        <p className="me-auto text-base" aria-live="polite" data-print-content>
          <span className="font-medium">{count}</span>
          {picked.length > 0 ? <span className="tabular-nums text-muted"> · {total}</span> : null}
        </p>
        {notice}
        {needsReview ? (
          <button
            type="button"
            disabled={picked.length === 0 || picked.some((unit) => unit.blocked !== null)}
            className={buttonClass()}
            onClick={goToReview}
          >
            {words.review}
          </button>
        ) : (
          <SubmitButton
            pendingLabel={words.submitting}
            disabled={picked.length === 0 || picked.some((unit) => unit.blocked !== null)}
            className={buttonClass()}
          >
            {words.submit}
          </SubmitButton>
        )}
      </StickyFormActions>
    </>
  );
}

/**
 * Enriched air going into a tank whose oxygen cleaning nobody recorded (issue
 * #2719): said on the tank's row once its gas passes the shop's fill method's
 * line (above air for blending, above 40% for membrane or premix, issue 3004),
 * and nothing more. No gate: the server accepts the fill exactly as before.
 */
function O2CleanWarning({
  warning,
  fill,
  nitroxFillMethod,
}: {
  warning: string | null;
  fill: string;
  nitroxFillMethod: NitroxFillMethod;
}) {
  if (!warning || !o2CleanWarnsForFill(nitroxFillMethod, Number(fill))) return null;
  return (
    <FormStatus tone="warning">
      <span className="text-base">{warning}</span>
    </FormStatus>
  );
}

/**
 * A tank's gas (#2257): a menu, never a typed figure, so nothing is rounded
 * into a different mix. Required, opening on a placeholder nobody can submit
 * (domain review F1); the writer refuses a tank with no gas, and EANx without
 * a nitrox card. Under it, the warning for EANx in a tank with no current
 * O2-clean record (issue #2719).
 */
function TankFillField({
  unit,
  aria,
  hintId,
  words,
  nitroxFillMethod,
  value,
  onChange,
  error,
}: {
  unit: Pick<PickerUnit, "id" | "o2CleanWarning">;
  aria: string;
  hintId: string;
  words: Pick<CartWords, "fillLabel" | "fillOptions">;
  nitroxFillMethod: NitroxFillMethod;
  value: string;
  onChange: (value: string) => void;
  error?: string;
}) {
  const field = (
    <Field
      label={words.fillLabel}
      error={error ? <span className="text-base">{error}</span> : undefined}
    >
      <select
        name={`${FILL_FIELD_PREFIX}${unit.id}`}
        value={value}
        onChange={(event) => onChange(event.currentTarget.value)}
        required
        aria-label={aria}
        aria-describedby={hintId}
        className={controlClass}
      >
        {words.fillOptions.map((option) => (
          <option key={option.value} value={option.value} disabled={option.value === ""}>
            {option.label}
          </option>
        ))}
      </select>
    </Field>
  );
  return (
    <>
      {field}
      <O2CleanWarning
        warning={unit.o2CleanWarning}
        fill={value}
        nitroxFillMethod={nitroxFillMethod}
      />
    </>
  );
}

function CounterRentalPayment({
  payment,
  payments,
  setPayment,
  paymentNote,
  invoiceExtras,
  words,
}: {
  payment: RentalPayment | null;
  payments: PaymentChoice[];
  setPayment: (payment: RentalPayment) => void;
  paymentNote: ReactNode;
  invoiceExtras: ReactNode;
  words: CartWords;
}) {
  return (
    <>
      {" "}
      <div>
        <ChoiceFieldset
          legend={words.payHeading}
          required
          className="min-w-0"
          bodyClassName="grid grid-cols-1 gap-2 sm:grid-cols-2"
        >
          {payments.map((choice) => (
            <ChoicePill
              key={choice.value}
              type="radio"
              name={PAYMENT_FIELD}
              value={choice.value}
              required
              checked={payment === choice.value}
              onChange={() => setPayment(choice.value)}
            >
              <span className="block font-medium">{choice.label}</span>
              {choice.hint ? <span className="block text-muted">{choice.hint}</span> : null}
            </ChoicePill>
          ))}
        </ChoiceFieldset>
        {paymentNote ? <p className="mt-3 text-sm text-muted">{paymentNote}</p> : null}
      </div>
      {payment === "invoice" ? invoiceExtras : null}
    </>
  );
}

function CounterRentalPickedItem({
  unit,
  inSet,
  price,
  fill,
  confirmed,
  hintId,
  payment,
  symbol,
  step,
  words,
  nitroxFillMethod,
  error,
  onPrice,
  onFill,
  onConfirm,
  onRemove,
}: {
  unit: PickerUnit;
  inSet: boolean;
  price: string;
  fill: string;
  confirmed: boolean;
  hintId: string;
  payment: RentalPayment | null;
  symbol: string;
  step: string;
  words: CartWords;
  nitroxFillMethod: NitroxFillMethod;
  error?: string;
  onPrice: (value: string) => void;
  onFill: (value: string) => void;
  onConfirm: (checked: boolean) => void;
  onRemove: () => void;
}) {
  return (
    <li className="flex flex-col gap-1 py-2">
      <input type="hidden" name={UNIT_FIELD} value={unit.id} />
      <div className="flex min-h-11 items-center gap-3">
        <p className="min-w-0 flex-1 text-base">
          <span className="font-medium">{unit.label}</span>
          {unit.size ? <span className="text-muted"> · {unit.size}</span> : null}
        </p>
        {inSet ? (
          <span className="w-28 shrink-0 text-end text-sm text-muted">{words.inSet}</span>
        ) : (
          <input
            type="number"
            name={`${PRICE_FIELD_PREFIX}${unit.id}`}
            required={payment !== null && payment !== "none"}
            max={payment === "none" ? undefined : 100_000}
            min={0}
            step={step}
            value={price}
            onChange={(event) => onPrice(event.currentTarget.value)}
            aria-label={unit.priceAria}
            placeholder={symbol}
            className={PRICE_BOX_CLASS}
          />
        )}
        <button
          type="button"
          aria-label={unit.removeAria}
          onClick={onRemove}
          className={buttonClass({ variant: "ghost", size: "icon" })}
        >
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            className="size-4"
          >
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </div>
      {unit.blocked ? (
        <FormStatus tone="danger">
          <span className="text-base">{unit.blocked}</span>
        </FormStatus>
      ) : null}
      {!unit.fillAria && error ? (
        <FormStatus tone="danger">
          <span className="text-base">{error}</span>
        </FormStatus>
      ) : null}
      {unit.fillAria ? (
        <TankFillField
          unit={unit}
          aria={unit.fillAria}
          hintId={hintId}
          words={words}
          nitroxFillMethod={nitroxFillMethod}
          value={fill}
          onChange={onFill}
          error={error}
        />
      ) : null}
      {unit.confirmLabel ? (
        <ChoiceRow
          type="checkbox"
          required
          name={`${CONFIRM_FIELD_PREFIX}${unit.id}`}
          className="text-sm"
          checked={confirmed}
          onChange={(event) => onConfirm(event.currentTarget.checked)}
        >
          <span className="text-base">{unit.confirmLabel}</span>
        </ChoiceRow>
      ) : null}
    </li>
  );
}
