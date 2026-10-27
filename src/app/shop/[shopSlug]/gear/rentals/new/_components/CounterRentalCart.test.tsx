// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import path from "node:path";
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
    o2CleanWarning: null,
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
  nitroxFillMethod: "blending",
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
    review: t("counterRentals.new.review"),
    fillLabel: t("counterRentals.new.fillLabel"),
    fillOptions: tankFillOptions(t, t("counterRentals.new.fillChoose")),
    fillHint: t("counterRentals.new.fillHint"),
  },
};

function Cart({
  restore = false,
  refusal = null,
  groups = props.groups,
  nitroxFillMethod = props.nitroxFillMethod,
}: {
  restore?: boolean;
  refusal?: ComponentProps<typeof CounterRentalCart>["refusal"];
  groups?: ComponentProps<typeof CounterRentalCart>["groups"];
  nitroxFillMethod?: ComponentProps<typeof CounterRentalCart>["nitroxFillMethod"];
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
        nitroxFillMethod={nitroxFillMethod}
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

describe("the rental total on paper", () => {
  it("keeps the selected item count and total outside every staff print-hide rule", () => {
    render(
      <div id="shop-main-content">
        <Cart />
      </div>,
    );
    fireEvent.click(within(gear()).getByRole("button", { name: "Tank 001· AL80" }));
    const footer = document.querySelector("[data-sticky-actions]");
    expect(footer).toHaveTextContent("1 item");
    expect(footer).toHaveTextContent("$10.00");
    const css = readFileSync(path.join(process.cwd(), "src/app/globals.css"), "utf8").replace(
      /\/\*[\s\S]*?\*\//g,
      "",
    );
    const hideRules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
      .filter(
        ([, selector, body]) =>
          selector.trim().startsWith("#shop-main-content") && /display:\s*none/.test(body),
      )
      .map(([, selector]) => selector.trim());
    expect(hideRules.length).toBeGreaterThan(0);
    for (const selector of hideRules) {
      expect(footer?.querySelector("p")?.closest(selector), selector).toBeNull();
    }
    const review = screen.getByRole("button", { name: props.words.review });
    expect(hideRules.some((selector) => review.closest(selector) !== null)).toBe(true);
    const editorActions = document.createElement("div");
    editorActions.setAttribute("data-sticky-actions", "");
    editorActions.innerHTML = '<button type="submit">Save</button>';
    document.getElementById("shop-main-content")?.append(editorActions);
    expect(hideRules.some((selector) => editorActions.matches(selector))).toBe(true);
  });
});

describe("the counter cart's local lookup", () => {
  it("puts Gear before review and guides a sticky action to the first unresolved control", () => {
    render(<Cart />);
    fireEvent.click(within(gear()).getByRole("button", { name: "Tank 001· AL80" }));
    expect(gear().compareDocumentPosition(bill()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: props.words.review }));
    expect(screen.getByRole("combobox", { name: tank1.fillAria ?? "" })).toHaveFocus();
    fireEvent.change(screen.getByRole("combobox", { name: tank1.fillAria ?? "" }), {
      target: { value: "21" },
    });
    fireEvent.click(screen.getByRole("button", { name: props.words.review }));
    expect(screen.getByRole("radio", { name: props.payments[0].label })).toHaveFocus();
    fireEvent.click(screen.getByRole("radio", { name: props.payments[0].label }));
    expect(screen.getByRole("button", { name: props.words.submit })).toHaveAttribute(
      "type",
      "submit",
    );
  });
  it("filters labels/sizes inside one kind, clears and resets on a kind change", () => {
    render(<Cart />);
    fireEvent.change(filter(), { target: { value: "002" } });
    expect(within(gear()).getAllByRole("listitem")).toHaveLength(1);
    fireEvent.click(within(gear()).getByRole("button", { name: "Tank 002· AL80" }));
    fireEvent.click(within(gear()).getByRole("button", { name: "Wetsuit" }));
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
    // Query roles once per phase, then exercise every real control. Repeated
    // accessible-tree scans of the growing 40-row cart dominated this test.
    const pickButtons = within(gear()).getAllByRole("button", { name: /^Tank \d{3}· AL80$/ });
    expect(pickButtons).toHaveLength(tanks.length);
    for (const [index, tank] of tanks.entries()) {
      expect(pickButtons[index]).toHaveAccessibleName(`${tank.label}· AL80`);
    }
    act(() => {
      for (const button of pickButtons) fireEvent.click(button);
    });
    const fills = screen.getAllByRole("combobox");
    const prices = screen.getAllByRole("spinbutton");
    expect(fills).toHaveLength(tanks.length);
    expect(prices).toHaveLength(tanks.length);
    for (const [index, tank] of tanks.entries()) {
      expect(fills[index]).toHaveAccessibleName(tank.fillAria ?? "");
      expect(prices[index]).toHaveAccessibleName(tank.priceAria);
    }
    act(() => {
      for (const [index] of tanks.entries()) {
        fireEvent.change(fills[index], { target: { value: "32" } });
        fireEvent.change(prices[index], { target: { value: typedPrice(index) } });
      }
    });
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
    const restoredFills = screen.getAllByRole("combobox");
    expect(restoredFills).toHaveLength(tanks.length);
    for (const [index, tank] of tanks.entries()) {
      expect(restored.get(`${PRICE_FIELD_PREFIX}${tank.id}`)).toBe(typedPrice(index));
      expect(restored.get(`${FILL_FIELD_PREFIX}${tank.id}`)).toBe("32");
      expect(restoredFills[index]).toHaveAccessibleName(tank.fillAria ?? "");
      expect(restoredFills[index]).toHaveAttribute("aria-invalid", "true");
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
    fireEvent.click(screen.getByRole("radio", { name: props.payments[0].label }));
    fireEvent.submit(screen.getByRole("form", { name: "Rental" }));
    cleanup();
    const unavailable = { ...tank1, blocked: t("counterRentals.new.unitUnavailable") };
    render(
      <Cart restore groups={[{ kind: "tank", kindLabel: "Tank", units: [unavailable, tank2] }]} />,
    );
    expect(bill()).toHaveTextContent(tank1.label);
    expect(fill(tank1)).toHaveValue("21");
    expect(within(bill()).getByText(unavailable.blocked)).toBeVisible();
    expect(screen.getByRole("button", { name: props.words.submit })).toBeDisabled();
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

describe("an EANx fill in a tank with no current O2-clean record (issue #2719)", () => {
  const uncleaned: PickerUnit = {
    ...unit("tank-4", "tank", "Tank 004", "AL80"),
    o2CleanWarning: t("counterRentals.new.o2CleanNever", { label: "Tank 004" }),
  };
  const lapsedWarning = t("counterRentals.new.o2CleanLapsed", { label: "Tank 005" });
  const lapsed: PickerUnit = {
    ...unit("tank-5", "tank", "Tank 005", "AL80"),
    o2CleanWarning: lapsedWarning,
  };
  const groups = [{ kind: "tank" as const, kindLabel: "Tank", units: [tank1, uncleaned, lapsed] }];
  const warning = t("counterRentals.new.o2CleanNever", { label: "Tank 004" });

  it("warns on that tank's row once its gas is EANx, and only then", () => {
    render(<Cart groups={groups} />);
    fireEvent.click(within(gear()).getByRole("button", { name: "Tank 004· AL80" }));
    fireEvent.click(within(gear()).getByRole("button", { name: "Tank 001· AL80" }));
    expect(screen.queryByText(warning)).toBeNull();

    fireEvent.change(fill(uncleaned), { target: { value: "21" } });
    expect(screen.queryByText(warning)).toBeNull();

    fireEvent.change(fill(uncleaned), { target: { value: "32" } });
    const row = within(bill())
      .getAllByRole("listitem")
      .find((item) => within(item).queryByText("Tank 004"));
    expect(row && within(row).getByText(warning)).toBeTruthy();
    expect(screen.getAllByText(warning)).toHaveLength(1);
  });

  it("says nothing for a tank whose O2-clean record is current", () => {
    render(<Cart groups={groups} />);
    fireEvent.click(within(gear()).getByRole("button", { name: "Tank 001· AL80" }));
    fireEvent.change(fill(tank1), { target: { value: "32" } });
    expect(
      screen.queryByText(t("counterRentals.new.o2CleanNever", { label: "Tank 001" })),
    ).toBeNull();
  });

  it("takes the warning back when the gas goes from EANx 32 to air", () => {
    render(<Cart groups={groups} />);
    fireEvent.click(within(gear()).getByRole("button", { name: "Tank 004· AL80" }));
    fireEvent.change(fill(uncleaned), { target: { value: "32" } });
    expect(screen.getByText(warning)).toBeTruthy();
    fireEvent.change(fill(uncleaned), { target: { value: "21" } });
    expect(screen.queryByText(warning)).toBeNull();
  });

  it("says a lapsed cleaning apart from one never recorded", () => {
    render(<Cart groups={groups} />);
    fireEvent.click(within(gear()).getByRole("button", { name: "Tank 004· AL80" }));
    fireEvent.click(within(gear()).getByRole("button", { name: "Tank 005· AL80" }));
    fireEvent.change(fill(uncleaned), { target: { value: "32" } });
    fireEvent.change(fill(lapsed), { target: { value: "32" } });
    expect(screen.getByText(warning)).toBeTruthy();
    expect(screen.getByText(lapsedWarning)).toBeTruthy();
    expect(warning).not.toBe(lapsedWarning);
  });

  it("warns without stopping the rental", () => {
    render(<Cart groups={groups} />);
    fireEvent.click(within(gear()).getByRole("button", { name: "Tank 004· AL80" }));
    fireEvent.change(fill(uncleaned), { target: { value: "36" } });
    fireEvent.click(screen.getByRole("radio", { name: props.payments[0].label }));
    expect(screen.getByText(warning)).toBeTruthy();
    expect(screen.getByRole("button", { name: props.words.submit })).toBeEnabled();
  });
});

/**
 * **The warning follows how the shop fills nitrox** (issue 3004). A blending
 * shop puts pure oxygen into the tank at any mix, so it is warned above air; a
 * membrane or premix shop is warned only above 40%, which the menu never
 * offers. Advisory either way: the rental still goes.
 */
describe("the O2-clean warning by the shop's nitrox fill method (issue 3004)", () => {
  const uncleaned: PickerUnit = {
    ...unit("tank-4", "tank", "Tank 004", "AL80"),
    o2CleanWarning: t("counterRentals.new.o2CleanNever", { label: "Tank 004" }),
  };
  const groups = [{ kind: "tank" as const, kindLabel: "Tank", units: [uncleaned] }];
  const warning = t("counterRentals.new.o2CleanNever", { label: "Tank 004" });

  function warnsAt(method: "blending" | "membrane_premix", mix: string) {
    render(<Cart groups={groups} nitroxFillMethod={method} />);
    fireEvent.click(within(gear()).getByRole("button", { name: "Tank 004· AL80" }));
    fireEvent.change(fill(uncleaned), { target: { value: mix } });
    fireEvent.click(screen.getByRole("radio", { name: props.payments[0].label }));
    const shown = screen.queryByText(warning) !== null;
    expect(screen.getByRole("button", { name: props.words.submit })).toBeEnabled();
    cleanup();
    return shown;
  }

  it("warns a blending shop at 32 and 40, never on air", () => {
    expect(warnsAt("blending", "21")).toBe(false);
    expect(warnsAt("blending", "32")).toBe(true);
    expect(warnsAt("blending", "40")).toBe(true);
  });

  it("does not warn a membrane or premix shop at 21, 32 or 40", () => {
    expect(warnsAt("membrane_premix", "21")).toBe(false);
    expect(warnsAt("membrane_premix", "32")).toBe(false);
    expect(warnsAt("membrane_premix", "40")).toBe(false);
  });
});
