// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { KeepTypedOnRefusal, keptTypedKey } from "@/components/KeepTypedOnRefusal";
import { tankFillOptions } from "@/i18n/gear-labels";
import { staffTranslator } from "@/i18n/staff-messages";
import { nowMs } from "@/lib/clock";
import {
  CART_FILLS_FIELD,
  COUNTER_RENTAL_FORM,
  FILL_FIELD_PREFIX,
  PAYMENT_FIELD,
  PRICE_FIELD_PREFIX,
  UNIT_FIELD,
} from "../../rental-form";
import { CounterRentalCart, type PickerUnit } from "./CounterRentalCart";

const t = staffTranslator("en-US");
const SCOPE = "blue-mantis.rental-counter";

afterEach(() => {
  cleanup();
  window.sessionStorage.clear();
});

function unit(id: string, kind: PickerUnit["kind"], label: string, size: string): PickerUnit {
  return {
    id,
    kind,
    label,
    size,
    care: [],
    blocked: null,
    confirmLabel: null,
    price: "10.00",
    priceAria: t("counterRentals.new.priceAria", { label }),
    removeAria: t("counterRentals.new.removeAria", { label }),
    fillAria: kind === "tank" ? t("counterRentals.new.fillAria", { label }) : null,
  };
}

const tank1 = unit("tank-1", "tank", "Tank 001", "AL80");
const tank2 = unit("tank-2", "tank", "Tank 002", "AL80");
const blocked = { ...unit("tank-3", "tank", "Tank 003", "AL80"), blocked: "Service overdue" };
const suit = unit("suit-1", "wetsuit", "Ázul 001", "2XL");
const props: ComponentProps<typeof CounterRentalCart> = {
  groups: [
    { kind: "tank", kindLabel: "Tank", units: [tank1, tank2, blocked] },
    { kind: "wetsuit", kindLabel: "Wetsuit", units: [suit] },
  ],
  coreKinds: [],
  setPrice: null,
  currency: "USD",
  locale: "en-US",
  step: "0.01",
  payments: [{ value: "none", label: t("counterRentals.new.pay.none") }],
  paymentNote: null,
  invoiceExtras: null,
  notice: null,
  words: {
    gearHeading: t("counterRentals.new.gearHeading"),
    kindsAria: t("counterRentals.new.kindsAria"),
    filterLabel: t("counterRentals.new.filterLabel"),
    clearFilter: t("counterRentals.new.clearFilter"),
    noMatches: t("counterRentals.new.noMatches"),
    billHeading: t("counterRentals.new.pickedHeading"),
    billEmpty: t("counterRentals.new.billEmpty"),
    inSet: t("counterRentals.new.inSet"),
    setLabel: t("counterRentals.new.setPrice", { count: 1 }),
    total: t("counterRentals.new.total"),
    payHeading: t("counterRentals.new.pay.heading"),
    items: { one: t("counterRentals.new.itemsOne"), other: t("counterRentals.new.itemsOther") },
    submit: t("counterRentals.new.submit"),
    submitting: t("counterRentals.new.submitting"),
    fillLabel: t("counterRentals.new.fillLabel"),
    fillOptions: tankFillOptions(t, t("counterRentals.new.fillChoose")),
    fillHint: t("counterRentals.new.fillHint"),
  },
};

function Cart({
  restore = false,
  refusal = null,
  groups = props.groups,
}: {
  restore?: boolean;
  refusal?: ComponentProps<typeof CounterRentalCart>["refusal"];
  groups?: ComponentProps<typeof CounterRentalCart>["groups"];
}) {
  return (
    <form aria-label="Rental" onSubmit={(event) => event.preventDefault()}>
      <KeepTypedOnRefusal form={COUNTER_RENTAL_FORM} scope={SCOPE} restore={restore} />
      <input type="hidden" name="personId" value="00000000-0000-4000-8000-000000000100" />
      <input type="hidden" name="from" value="2026-10-21" />
      <input type="hidden" name="until" value="2026-10-21" />
      <CounterRentalCart
        {...props}
        groups={groups}
        restoreKept={restore ? SCOPE : null}
        refusal={refusal}
      />
    </form>
  );
}

const gear = () => screen.getByRole("region", { name: props.words.gearHeading });
const bill = () => screen.getByRole("list", { name: props.words.billHeading });
const filter = () => screen.getByRole("searchbox", { name: props.words.filterLabel });
const fill = (tank: PickerUnit) => screen.getByRole("combobox", { name: tank.fillAria ?? "" });

describe("the counter cart's local lookup", () => {
  it("filters labels/sizes inside one kind, clears and resets on a kind change", () => {
    render(<Cart />);
    fireEvent.change(filter(), { target: { value: "002" } });
    expect(within(gear()).getAllByRole("listitem")).toHaveLength(1);
    fireEvent.click(within(gear()).getByRole("button", { name: "Tank 002· AL80" }));
    fireEvent.click(within(gear()).getByRole("button", { name: "Wetsuit", exact: true }));
    expect(filter()).toHaveValue("");
    fireEvent.change(filter(), { target: { value: "azul 2xl" } });
    expect(within(gear()).getAllByRole("listitem")).toHaveLength(1);
    fireEvent.click(within(gear()).getByRole("button", { name: "Ázul 001· 2XL" }));
    fireEvent.change(filter(), { target: { value: "absent" } });
    expect(within(gear()).getByText(props.words.noMatches)).toBeVisible();
    expect(bill()).toHaveTextContent(tank2.label);
    expect(bill()).toHaveTextContent(suit.label);
    fireEvent.click(within(bill()).getByRole("button", { name: tank2.removeAria }));
    expect(bill()).not.toHaveTextContent(tank2.label);
    fireEvent.click(screen.getByRole("button", { name: props.words.clearFilter }));
    expect(filter()).toHaveValue("");
    expect(within(gear()).getByRole("button", { name: "Ázul 001· 2XL" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("keeps a matched blocked unit disabled and stops search Enter from submitting a rental", () => {
    render(<Cart />);
    fireEvent.change(filter(), { target: { value: "003" } });
    expect(within(gear()).getByRole("button", { name: /Tank 003/ })).toBeDisabled();
    expect(within(gear()).getByText(blocked.blocked)).toBeVisible();
    const event = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
    filter().dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });
});

describe("issue 2723 refused cart", () => {
  it("keeps all 40 tanks, typed prices, EANx and No charge after a nitrox-card refusal", async () => {
    const tanks = Array.from({ length: 40 }, (_, index) =>
      unit(
        `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
        "tank",
        `Tank ${String(index + 1).padStart(3, "0")}`,
        "AL80",
      ),
    );
    const groups = [{ kind: "tank" as const, kindLabel: "Tank", units: tanks }];
    const typedPrice = (index: number) => `${index + 50}.25`;
    render(<Cart groups={groups} />);
    for (const [index, tank] of tanks.entries()) {
      fireEvent.click(within(gear()).getByRole("button", { name: `${tank.label}· AL80` }));
      fireEvent.change(fill(tank), { target: { value: "32" } });
      fireEvent.change(screen.getByRole("spinbutton", { name: tank.priceAria }), {
        target: { value: typedPrice(index) },
      });
    }
    fireEvent.click(screen.getByRole("radio", { name: t("counterRentals.new.pay.none") }));
    fireEvent.submit(screen.getByRole("form", { name: "Rental" }));
    cleanup();
    render(
      <Cart
        groups={groups}
        restore
        refusal={{
          code: "no-nitrox-card",
          unitId: null,
          message: t("counterRentals.new.notice.noNitroxCard"),
        }}
      />,
    );
    await act(async () => {
      (screen.getByRole("form", { name: "Rental" }) as HTMLFormElement).reset();
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    });
    const restored = new FormData(screen.getByRole("form", { name: "Rental" }) as HTMLFormElement);
    expect(restored.getAll(UNIT_FIELD)).toEqual(tanks.map((tank) => tank.id));
    expect(restored.get(PAYMENT_FIELD)).toBe("none");
    for (const [index, tank] of tanks.entries()) {
      expect(restored.get(`${PRICE_FIELD_PREFIX}${tank.id}`)).toBe(typedPrice(index));
      expect(restored.get(`${FILL_FIELD_PREFIX}${tank.id}`)).toBe("32");
      expect(fill(tank)).toHaveAttribute("aria-invalid", "true");
    }
  });

  it("keeps all 40 selected soft-goods confirmations after a refusal", () => {
    const suits = Array.from({ length: 40 }, (_, index) => ({
      ...unit(
        `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
        "wetsuit",
        `Suit ${String(index + 1).padStart(3, "0")}`,
        "L",
      ),
      confirmLabel: `Lend suit ${index + 1} anyway`,
    }));
    const groups = [{ kind: "wetsuit" as const, kindLabel: "Wetsuit", units: suits }];
    render(<Cart groups={groups} />);
    for (const suit of suits) {
      fireEvent.click(within(gear()).getByRole("button", { name: `${suit.label}· L` }));
      fireEvent.click(screen.getByRole("checkbox", { name: suit.confirmLabel }));
    }
    fireEvent.click(screen.getByRole("radio", { name: t("counterRentals.new.pay.none") }));
    fireEvent.submit(screen.getByRole("form", { name: "Rental" }));
    cleanup();
    render(<Cart groups={groups} restore />);
    for (const suit of suits) {
      expect(screen.getByRole("checkbox", { name: suit.confirmLabel })).toBeChecked();
    }
  });

  it("leaves an unsupported stored fill unknown instead of choosing a gas", () => {
    window.sessionStorage.setItem(
      keptTypedKey(COUNTER_RENTAL_FORM, SCOPE),
      JSON.stringify({
        at: nowMs(),
        fields: {
          [UNIT_FIELD]: tank1.id,
          [CART_FILLS_FIELD]: JSON.stringify({ [tank1.id]: "99" }),
        },
      }),
    );
    render(
      <Cart
        restore
        refusal={{
          code: "fill-invalid",
          unitId: null,
          message: t("counterRentals.new.notice.fillInvalid"),
        }}
      />,
    );
    expect(fill(tank1)).toHaveValue("");
    expect(fill(tank1)).toHaveAttribute("aria-invalid", "true");
  });

  it("keeps other rows and their gas, leaves unknown gas blank and marks that row", () => {
    render(<Cart />);
    fireEvent.click(within(gear()).getByRole("button", { name: "Tank 001· AL80" }));
    fireEvent.click(within(gear()).getByRole("button", { name: "Tank 002· AL80" }));
    fireEvent.change(fill(tank1), { target: { value: "32" } });
    fireEvent.click(screen.getByRole("radio", { name: t("counterRentals.new.pay.none") }));
    fireEvent.submit(screen.getByRole("form", { name: "Rental" }));
    cleanup();
    render(
      <Cart
        restore
        refusal={{
          code: "fill-missing",
          unitId: null,
          message: t("counterRentals.new.notice.fillMissing"),
        }}
      />,
    );
    expect(bill()).toHaveTextContent(tank1.label);
    expect(bill()).toHaveTextContent(tank2.label);
    expect(fill(tank1)).toHaveValue("32");
    expect(fill(tank2)).toHaveValue("");
    expect(fill(tank2)).toHaveAttribute("aria-invalid", "true");
    expect(within(fill(tank2).closest("li") as HTMLElement).getByRole("alert")).toHaveTextContent(
      t("counterRentals.new.notice.fillMissing"),
    );
    expect(screen.getByRole("radio", { name: t("counterRentals.new.pay.none") })).toBeChecked();
  });

  it("keeps an EANx choice after a nitrox-card refusal without changing it to air", () => {
    render(<Cart />);
    fireEvent.click(within(gear()).getByRole("button", { name: "Tank 001· AL80" }));
    fireEvent.change(fill(tank1), { target: { value: "32" } });
    fireEvent.submit(screen.getByRole("form", { name: "Rental" }));
    cleanup();
    render(
      <Cart
        restore
        refusal={{
          code: "no-nitrox-card",
          unitId: null,
          message: t("counterRentals.new.notice.noNitroxCard"),
        }}
      />,
    );
    expect(fill(tank1)).toHaveValue("32");
    expect(fill(tank1)).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("alert")).toHaveTextContent(
      t("counterRentals.new.notice.noNitroxCard"),
    );
  });

  it("keeps a newly unavailable pick removable and disables renting it out", () => {
    render(<Cart />);
    fireEvent.click(within(gear()).getByRole("button", { name: "Tank 001· AL80" }));
    fireEvent.change(fill(tank1), { target: { value: "21" } });
    fireEvent.submit(screen.getByRole("form", { name: "Rental" }));
    cleanup();
    const unavailable = { ...tank1, blocked: t("counterRentals.new.unitUnavailable") };
    render(
      <Cart restore groups={[{ kind: "tank", kindLabel: "Tank", units: [unavailable, tank2] }]} />,
    );
    expect(bill()).toHaveTextContent(tank1.label);
    expect(fill(tank1)).toHaveValue("21");
    expect(within(bill()).getByText(unavailable.blocked)).toBeVisible();
    expect(screen.getByRole("button", { name: props.words.submit, exact: true })).toBeDisabled();
    fireEvent.click(within(bill()).getByRole("button", { name: tank1.removeAria }));
    expect(screen.queryByRole("list", { name: props.words.billHeading })).toBeNull();
  });

  it("restores choices after a repeated refusal resets the native form", async () => {
    render(<Cart />);
    fireEvent.click(within(gear()).getByRole("button", { name: "Tank 001· AL80" }));
    fireEvent.click(within(gear()).getByRole("button", { name: "Tank 002· AL80" }));
    fireEvent.change(fill(tank1), { target: { value: "32" } });
    fireEvent.submit(screen.getByRole("form", { name: "Rental" }));
    cleanup();
    render(
      <Cart
        restore
        refusal={{
          code: "fill-missing",
          unitId: null,
          message: t("counterRentals.new.notice.fillMissing"),
        }}
      />,
    );
    await act(async () => {
      (screen.getByRole("form", { name: "Rental" }) as HTMLFormElement).reset();
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    });
    expect(fill(tank1)).toHaveValue("32");
    expect(fill(tank2)).toHaveValue("");
  });
});
