// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { keptTypedKey } from "@/components/KeepTypedOnRefusal";
import { nowMs } from "@/lib/clock";
import { draftableFields, FORM_DRAFT_FIELD_MAX } from "@/lib/form-drafts";
import {
  CART_CONFIRMED_FIELD,
  CART_FILLS_FIELD,
  CART_PAYMENT_FIELD,
  CART_PRICE_FIELD_PREFIX,
  CART_SET_PRICE_FIELD,
  CART_UNITS_FIELD,
  COUNTER_RENTAL_FORM,
  UNIT_FIELD,
} from "../../rental-form";
import { readKeptCart } from "./kept-cart";

afterEach(() => window.sessionStorage.clear());

describe("readKeptCart", () => {
  it("keeps 40 UUIDs and full draftable prices ahead of the generic field-count limit", () => {
    const ids = Array.from(
      { length: 40 },
      (_, index) => `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
    );
    const price = `1.${"0".repeat(FORM_DRAFT_FIELD_MAX - 2)}`;
    const fills = Object.fromEntries(ids.map((id, index) => [id, index === 39 ? "" : "32"]));
    const entries: [string, string][] = [
      ["personId", "00000000-0000-4000-8000-000000000100"],
      ["from", "2026-10-21"],
      ["until", "2026-10-21"],
      [CART_UNITS_FIELD, ids.join(" ")],
      [CART_PAYMENT_FIELD, "none"],
      [CART_SET_PRICE_FIELD, "123.45"],
      [CART_FILLS_FIELD, JSON.stringify(fills)],
      [CART_CONFIRMED_FIELD, ids.join(" ")],
      ...ids.map((id): [string, string] => [`${CART_PRICE_FIELD_PREFIX}${id}`, price]),
      ...Array.from({ length: 80 }, (_, index): [string, string] => [`row-${index}`, "row"]),
    ];
    window.sessionStorage.setItem(
      keptTypedKey(COUNTER_RENTAL_FORM, "reef.desk"),
      JSON.stringify({ at: nowMs(), fields: draftableFields(entries) }),
    );
    expect(readKeptCart("reef.desk", (id) => ids.includes(id))).toEqual({
      ids,
      prices: Object.fromEntries(ids.map((id) => [id, price])),
      fills,
      confirmed: ids,
      setFigure: "123.45",
      payment: "none",
    });
  });

  it("bounds restored picks and intersects every compact value with the current register", () => {
    const ids = Array.from({ length: 41 }, (_, index) => `t${index}`);
    window.sessionStorage.setItem(
      keptTypedKey(COUNTER_RENTAL_FORM, "reef.desk"),
      JSON.stringify({
        at: nowMs(),
        fields: {
          [CART_UNITS_FIELD]: `outside ${ids.join(" ")} t0`,
          [CART_PAYMENT_FIELD]: "forged",
          [CART_SET_PRICE_FIELD]: "0".repeat(FORM_DRAFT_FIELD_MAX + 1),
          [`${CART_PRICE_FIELD_PREFIX}t0`]: "0".repeat(FORM_DRAFT_FIELD_MAX + 1),
          [`${CART_PRICE_FIELD_PREFIX}outside`]: "99",
          [CART_FILLS_FIELD]: JSON.stringify({ t0: "32", outside: "40", t40: "36" }),
          [CART_CONFIRMED_FIELD]: "outside t0 t40 t0",
        },
      }),
    );
    expect(readKeptCart("reef.desk", (id) => ids.includes(id))).toEqual({
      ids: ids.slice(0, 40),
      prices: {},
      fills: { t0: "32" },
      confirmed: ["t0"],
      setFigure: undefined,
      payment: undefined,
    });
  });

  it("rejects oversized compact ID, gas and confirmation values", () => {
    const fields = {
      [CART_UNITS_FIELD]: "t1 ".repeat(FORM_DRAFT_FIELD_MAX),
      [CART_FILLS_FIELD]: JSON.stringify({ t1: "3".repeat(FORM_DRAFT_FIELD_MAX) }),
      [CART_CONFIRMED_FIELD]: "t1 ".repeat(FORM_DRAFT_FIELD_MAX),
    };
    const key = keptTypedKey(COUNTER_RENTAL_FORM, "reef.desk");
    window.sessionStorage.setItem(key, JSON.stringify({ at: nowMs(), fields }));
    expect(readKeptCart("reef.desk", () => true)).toMatchObject({
      ids: [],
      fills: {},
      confirmed: [],
    });
    window.sessionStorage.setItem(
      key,
      JSON.stringify({ at: nowMs(), fields: { ...fields, [CART_UNITS_FIELD]: "t1" } }),
    );
    expect(readKeptCart("reef.desk", () => true)).toMatchObject({
      ids: ["t1"],
      fills: {},
      confirmed: [],
    });
  });

  it("restores chosen and blank fills only for units in this server-rendered register", () => {
    window.sessionStorage.setItem(
      keptTypedKey(COUNTER_RENTAL_FORM, "reef.desk"),
      JSON.stringify({
        at: nowMs(),
        fields: {
          [UNIT_FIELD]: "t1 t2 outside",
          [CART_FILLS_FIELD]: JSON.stringify({ t1: "32", t2: "", outside: "40" }),
        },
      }),
    );
    expect(readKeptCart("reef.desk", (id) => id !== "outside")?.fills).toEqual({
      t1: "32",
      t2: "",
    });
    expect(readKeptCart("reef.other", () => true)).toBeNull();
  });

  it("never makes a gas choice from corrupt stored fields", () => {
    window.sessionStorage.setItem(
      keptTypedKey(COUNTER_RENTAL_FORM, "reef.desk"),
      JSON.stringify({ at: nowMs(), fields: { [UNIT_FIELD]: "t1", [CART_FILLS_FIELD]: "[21]" } }),
    );
    expect(readKeptCart("reef.desk", () => true)?.fills).toEqual({});
  });
});
