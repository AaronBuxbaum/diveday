import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { DiverProfile } from "../_components/shared";
import { canRaiseInvoiceFor } from "./invoice-door";

/**
 * **Two surfaces ask this, and a disagreement between them is the bug.**
 *
 * `DiverStory` asks it to decide whether "New invoice" renders at the foot of
 * the story; `buildDiverStatus` asks it to decide whether the ledger's
 * **Collect** row carries an act, because with no order raised that act's only
 * destination *is* that link. Before this predicate the story gated on three
 * facts and the ledger gated on none, so the ledger offered a fix whose target
 * the story had already removed (issue #1926, the loose end of #1920).
 */
const diver = (person: Partial<DiverProfile["person"]> = {}) =>
  ({ person: { id: "person-1", fullName: "Grace Mensah", ...person } }) as DiverProfile;

describe("whether a reader could raise an invoice at all", () => {
  it("says yes only when every fact says yes", () => {
    expect(canRaiseInvoiceFor(diver(), { canManageOrders: true, paymentsConnected: true })).toBe(
      true,
    );
  });

  it("says no to a reader the shop has not trusted with orders", () => {
    // The live `src/db/authz.ts` answer, which `orders/new` has always
    // enforced and the link learned to ask in #1920.
    expect(canRaiseInvoiceFor(diver(), { canManageOrders: false, paymentsConnected: true })).toBe(
      false,
    );
  });

  it("says no at a shop that cannot take money, however senior the reader", () => {
    // This half predates the permission one: with Stripe unconnected there has
    // never been a link, for anybody.
    expect(canRaiseInvoiceFor(diver(), { canManageOrders: true, paymentsConnected: false })).toBe(
      false,
    );
  });

  it("says no about a removed diver, who is not someone to bill", () => {
    expect(
      canRaiseInvoiceFor(diver({ deletedAt: new Date("2026-08-01T00:00:00.000Z") }), {
        canManageOrders: true,
        paymentsConnected: true,
      }),
    ).toBe(false);
  });

  /**
   * The one caller that cannot answer. `DiverStory`'s `offersInvoice: false`
   * arm types `canManageOrders` as `never` on purpose — a reading that never
   * looked the reader up has no honest answer to give — so `undefined` has to
   * mean no rather than throw or pass.
   */
  it("reads an unasked permission as no, never as yes", () => {
    expect(
      canRaiseInvoiceFor(diver(), { canManageOrders: undefined, paymentsConnected: true }),
    ).toBe(false);
  });
});

/**
 * The half a unit test cannot reach by calling anything: that both callers
 * actually go through this predicate rather than re-spelling its three facts.
 * Read as text, the same way `chrome.test.ts` reads `globals.css` — a rule
 * about who calls what is exactly the kind that rots silently.
 */
describe("the two surfaces that must not disagree", () => {
  const read = (file: string) =>
    readFile(path.join(process.cwd(), file), "utf8") as Promise<string>;

  it("is what the story's invoice link is gated on", async () => {
    const story = await read(
      "src/app/shop/[shopSlug]/divers/[personId]/_components/DiverStory.tsx",
    );
    expect(story).toContain(
      "offersInvoice && canRaiseInvoiceFor(diver, { canManageOrders, paymentsConnected })",
    );
    // The three facts spelled out again here would be the drift this prevents.
    expect(story, "the story re-spells the gate instead of asking for it").not.toMatch(
      /canManageOrders && paymentsConnected && !diver\.person\.deletedAt/,
    );
  });

  it("is what the record hands the status ledger", async () => {
    const page = await read("src/app/shop/[shopSlug]/divers/[personId]/page.tsx");
    expect(page).toMatch(/const collectHasSomewhereToGo = canRaiseInvoiceFor\(diver, \{/);
    expect(page).toMatch(
      /diverStatusRows\(db, shop\.id, diver, now, \{ collectHasSomewhereToGo \}\)/,
    );
  });
});
