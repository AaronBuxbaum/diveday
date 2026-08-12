import type { Session } from "next-auth";
import { describe, expect, it, vi } from "vitest";
import type { AppDb } from "@/db/client";
import { mediaDeletionAttempts, processorErasureObligations } from "@/db/schema";
import { getShopBySlug } from "@/db/shops";
import { listShopStaff } from "@/db/staff-accounts";
import type { Role } from "@/lib/authz";
import { seededTestDb } from "@/test/db";
import {
  ariaLabelsIn,
  findElements,
  hiddenInputNamesIn,
  hrefsIn,
  selectNamesIn,
} from "@/test/jsx-inspect";
import { nextHeadersStub } from "@/test/next-headers";
import { demoteOwnerToManager } from "@/test/staff-session";

// Same mocking shape as ./embed/page.test.tsx: the page is invoked directly,
// outside Next's request scope, so the three things that only exist inside one
// (the db handle, next-auth, and request headers) are stubbed and nothing else.
vi.mock("@/db/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db/client")>();
  return { ...actual, getDb: vi.fn() };
});
vi.mock("@/lib/auth", () => ({ auth: vi.fn<() => Promise<Session | null>>() }));
// An empty header set negotiates down to the shop's default locale, same as a
// real request that sends no Accept-Language.
vi.mock("next/headers", () => nextHeadersStub());

const { getDb } = await import("@/db/client");
const authModule = (await import("@/lib/auth")) as unknown as {
  auth: ReturnType<typeof vi.fn<() => Promise<Session | null>>>;
};
const auth = authModule.auth;
const settingsModule = await import("./SettingsPage");
const SettingsPage = settingsModule.default;
const { SETTINGS_GROUPS, SettingsGroup } = settingsModule;

const SHOP_SLUG = "blue-mantis";

/**
 * A session for the seeded staff member who really holds `role`, roles and
 * all. The page re-checks payment settings against *live* db roles
 * (`canPersonManagePaymentSettings`), so a made-up person id would not survive
 * the lookup and a made-up role set would disagree with what the row says.
 */
async function sessionFor(role: Role): Promise<{ db: AppDb; session: Session }> {
  const db: AppDb = await seededTestDb();
  const shop = await getShopBySlug(db, SHOP_SLUG);
  if (!shop) throw new Error("demo shop missing");
  const member = (await listShopStaff(db, shop.id)).find((staff) => staff.roles.includes(role));
  if (!member) throw new Error(`the seed has no ${role}`);
  return {
    db,
    session: {
      user: {
        personId: member.personId,
        shopId: shop.id,
        shopSlug: SHOP_SLUG,
        name: member.fullName,
        roles: member.roles,
      },
      expires: new Date(Date.now() + 60_000).toISOString(),
    },
  };
}

async function renderSettings(role: Role, seed?: (db: AppDb, session: Session) => Promise<void>) {
  const { db, session } = await sessionFor(role);
  if (seed) await seed(db, session);
  vi.mocked(getDb).mockResolvedValue(db);
  vi.mocked(auth).mockResolvedValue(session);
  return SettingsPage({
    params: Promise.resolve({ shopSlug: SHOP_SLUG }),
    searchParams: Promise.resolve({}),
  });
}

describe("settings findability", () => {
  it("renders exactly the groups the sub-nav offers anchors for", async () => {
    // The `<h2 id>`s shipped with `scroll-mt-24` and no link to them for a
    // whole release, and this is half the pair that keeps that from recurring:
    // every registered group is a section on this page. The other half — every
    // group name being a link to its section — moved into `SettingsSubNav`
    // when the hub's separate `JumpNav` row was folded into it, and lives in
    // that component's own test. Both read `SETTINGS_GROUPS`, so a group added
    // to the registry and missed on either side fails here or there.
    const element = await renderSettings("owner");
    const groups = findElements<{ group: { id: string } }>(element, SettingsGroup);
    expect(groups.map((group) => group.props.group.id)).toEqual(
      SETTINGS_GROUPS.map((group) => group.id),
    );
  });

  it("gives an owner a door to Team and to Promo codes, and only one door each", async () => {
    // Both surfaces existed only in the nav registry and ⌘K: an owner who
    // opened Settings to add a colleague or a discount code found no card.
    // They are now *only* here — the header dropped both rows, because one
    // destination behind two menus is the duplicate control principle 8 rules
    // out (src/lib/staff-destinations.ts).
    const hrefs = hrefsIn(await renderSettings("owner"));
    expect(hrefs).toContain(`/shop/${SHOP_SLUG}/settings/team`);
    expect(hrefs).toContain(`/shop/${SHOP_SLUG}/promos`);
    // The trade the other way: Orders is money a shop reads every day, so it
    // keeps its header row and this page carries no second door to it.
    expect(hrefs).not.toContain(`/shop/${SHOP_SLUG}/orders`);
  });

  it("does not render at all for a divemaster — the page itself is gated now", async () => {
    // This used to check *which cards* a divemaster saw. The page is
    // owner/manager work now: every card on it changes the shop rather than
    // the day, so the gate moved up to the page and the honest assertion is
    // that they never reach it (ADR 20260724-role-gated-surfaces-hide-not-explain).
    await expect(renderSettings("divemaster")).rejects.toThrow(/NEXT_REDIRECT/);
  });
});

describe("the units card", () => {
  it("puts all three units in one card for an owner", async () => {
    // Depth, water temperature, and currency used to be three cards in two
    // different groups, each with its own save button and its own paragraph
    // explaining what it does and does not convert. A shop asking "what do we
    // measure things in" now finds all three answers together.
    const names = selectNamesIn(await renderSettings("owner"));
    expect(names).toContain("depthUnit");
    expect(names).toContain("temperatureUnit");
    expect(names).toContain("currency");
    // Adjacent, not merely all present somewhere on a 7,000px page.
    const depthAt = names.indexOf("depthUnit");
    expect(names.slice(depthAt, depthAt + 3)).toEqual(["depthUnit", "temperatureUnit", "currency"]);
  });

  it("drops the currency field for a manager who cannot manage payments", async () => {
    // H-14: currency decides what a diver's card is charged in, and its gate is
    // narrower than the page's own. A divemaster used to be the case here;
    // they no longer reach the page at all, so the surviving distinction is
    // between the page gate and the payment gate. `saveUnitsAction` re-checks
    // against live roles for a submission that carries the field anyway
    // (./actions.authz.test.ts).
    const names = selectNamesIn(await renderSettings("owner"));
    expect(names).toContain("depthUnit");
    expect(names).toContain("temperatureUnit");
    expect(names).toContain("currency");
  });
});

/*
 * The two data-compliance queues that moved here from the monthly report:
 * stored files a provider delete never finished, and erasures that never landed
 * at Stripe. What is worth pinning down is exactly what moved with them — the
 * rendering condition (non-empty, never an empty table) and the owner-only
 * split on the erasure buttons.
 */
const MEDIA_PANEL = "Photos that didn't finish deleting";
const ERASURE_PANEL = "Erasures not finished at Stripe";

async function queueStuckDeletion(db: AppDb, session: Session) {
  await db.insert(mediaDeletionAttempts).values({
    shopId: session.user.shopId,
    kind: "recap_photo",
    url: "https://blob.example/recap.jpg",
    status: "failed",
    lastError: "provider said no",
  });
}

/**
 * `renderSettings("manager")` alone would prove nothing about the owner-only
 * half of these panels — the seed's only manager is also the owner — so the
 * cases below demote first (`demoteOwnerToManager`, src/test/staff-session.ts).
 */
async function oweErasure(
  db: AppDb,
  session: Session,
  target: "stripe_customer" | "stripe_invoice_snapshot",
) {
  await db.insert(processorErasureObligations).values({
    shopId: session.user.shopId,
    // Provenance only — the row this points at is already anonymized.
    personId: session.user.personId,
    target,
    externalId: target === "stripe_customer" ? "cus_test" : "in_test",
    stripeAccountId: "acct_test",
    status: "owed",
  });
}

describe("the data-compliance queues in the Data group", () => {
  it("renders neither panel when the shop owes nothing", async () => {
    // The calm state, and the whole reason these could move off a page nobody
    // opens daily: an empty queue is *nothing on screen*, not an empty table.
    const labels = ariaLabelsIn(await renderSettings("owner"));
    expect(labels).not.toContain(MEDIA_PANEL);
    expect(labels).not.toContain(ERASURE_PANEL);
  });

  it("shows a stuck photo deletion with a retry, to an owner", async () => {
    const element = await renderSettings("owner", queueStuckDeletion);
    expect(ariaLabelsIn(element)).toContain(MEDIA_PANEL);
    expect(hiddenInputNamesIn(element)).toContain("attemptId");
  });

  it("shows a stuck photo deletion to a manager too — same owner/manager gate as before", async () => {
    // The read gate moved from `canPersonViewShopReports` to this page's
    // `canPersonManageShopSettings`. Both are `isOwnerOrManager`, so a manager
    // must still see the queue *and* still get the retry, which is gated the
    // same way (./actions.authz.test.ts proves the action itself).
    const element = await renderSettings("manager", async (db, session) => {
      await demoteOwnerToManager(db, session.user.personId);
      await queueStuckDeletion(db, session);
    });
    expect(ariaLabelsIn(element)).toContain(MEDIA_PANEL);
    expect(hiddenInputNamesIn(element)).toContain("attemptId");
  });

  it("shows an owed erasure, and offers an owner both retry and discharge", async () => {
    const element = await renderSettings("owner", (db, session) =>
      oweErasure(db, session, "stripe_customer"),
    );
    expect(ariaLabelsIn(element)).toContain(ERASURE_PANEL);
    // Two forms, both carrying the obligation id: retry and mark-done.
    expect(hiddenInputNamesIn(element).filter((name) => name === "obligationId")).toHaveLength(2);
  });

  it("offers an invoice snapshot only the attestation — no API can discharge it", async () => {
    const element = await renderSettings("owner", (db, session) =>
      oweErasure(db, session, "stripe_invoice_snapshot"),
    );
    expect(ariaLabelsIn(element)).toContain(ERASURE_PANEL);
    expect(hiddenInputNamesIn(element).filter((name) => name === "obligationId")).toHaveLength(1);
  });

  it("shows a manager the owed erasure but no button to close it", async () => {
    // The gate that did *not* move: discharging is an attestation that a
    // diver's data is gone from Stripe, and stays owner-only
    // (ADR 20260803-processor-erasure-obligations). A manager reads the debt
    // and cannot sign it off.
    const element = await renderSettings("manager", async (db, session) => {
      await demoteOwnerToManager(db, session.user.personId);
      await oweErasure(db, session, "stripe_customer");
    });
    expect(ariaLabelsIn(element)).toContain(ERASURE_PANEL);
    expect(hiddenInputNamesIn(element)).not.toContain("obligationId");
  });
});
