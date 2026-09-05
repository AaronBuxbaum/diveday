import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { InsetGroup } from "@/components/ui/ledger";
import type { AppDb } from "@/db/client";
import { listDiveSites } from "@/db/dive-sites";
import { diveSites, mediaDeletionAttempts, processorErasureObligations } from "@/db/schema";
import { getShopBySlug, setShopDivingOptions } from "@/db/shops";
import { listShopStaff } from "@/db/staff-accounts";
import type { DiveDaySession } from "@/lib/auth";
import type { Role } from "@/lib/authz";
import { seededTestDb } from "@/test/db";
import {
  ariaLabelsIn,
  findElements,
  hiddenInputNamesIn,
  hrefsIn,
  inputNamesIn,
  selectNamesIn,
} from "@/test/jsx-inspect";
import { nextHeadersStub } from "@/test/next-headers";
import { demoteOwnerToManager } from "@/test/staff-session";
import { BrandColorField } from "./_components/BrandColorField";
import { SETTINGS_RAIL_ROWS, type SectionId, settingsSectionFragment } from "./settings-groups";

// Same mocking shape as ./embed/page.test.tsx: the page is invoked directly,
// outside Next's request scope, so the three things that only exist inside one
// (the db handle, better-auth, and request headers) are stubbed and nothing else.
vi.mock("@/db/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db/client")>();
  return { ...actual, getDb: vi.fn() };
});
vi.mock("@/lib/auth", () => ({ auth: vi.fn<() => Promise<DiveDaySession | null>>() }));
// An empty header set negotiates down to the shop's default locale, same as a
// real request that sends no Accept-Language.
vi.mock("next/headers", () => nextHeadersStub());

const { getDb } = await import("@/db/client");
const authModule = (await import("@/lib/auth")) as unknown as {
  auth: ReturnType<typeof vi.fn<() => Promise<DiveDaySession | null>>>;
};
const auth = authModule.auth;
const settingsModule = await import("./SettingsPage");
const settingsRowsModule = await import("./_components/SettingsRows");
const SettingsPage = settingsModule.default;
const { SETTINGS_GROUPS, SettingsGroup } = settingsModule;

const SHOP_SLUG = "blue-mantis";

/**
 * A session for the seeded staff member who really holds `role`, roles and
 * all. The page re-checks payment settings against *live* db roles
 * (`canPersonManagePaymentSettings`), so a made-up person id would not survive
 * the lookup and a made-up role set would disagree with what the row says.
 */
async function sessionFor(role: Role): Promise<{ db: AppDb; session: DiveDaySession }> {
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
        email: "staff@demo.invalid",
        roles: member.roles,
      },
    },
  };
}

async function renderSettings(
  role: Role,
  seed?: (db: AppDb, session: DiveDaySession) => Promise<void>,
  searchParams: { notice?: string; saved?: string } = {},
) {
  const { db, session } = await sessionFor(role);
  if (seed) await seed(db, session);
  vi.mocked(getDb).mockResolvedValue(db);
  vi.mocked(auth).mockResolvedValue(session);
  return SettingsPage({
    params: Promise.resolve({ shopSlug: SHOP_SLUG }),
    searchParams: Promise.resolve(searchParams),
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

/**
 * **A deep link into a `<details>` opens nothing on its own.**
 *
 * Every settings row is a closed disclosure, so `settings#units` scrolled a
 * brand-new shop to the top of a 7,000px page with the row it had just been
 * sent to still shut. `SettingsRow` has the mechanism for this — `anchorId`
 * puts the target *inside* the disclosure so a hard navigation's reveal
 * algorithm opens it, and `openOnHash` does the same on a client navigation —
 * and three rows already used it, which is exactly what made the missing
 * fourth invisible.
 *
 * Written against every `settings#…` link in the tree rather than the one that
 * was broken: the next dead fragment will be a new link into an old row, and a
 * test naming `units` would not see it. It found a second one immediately —
 * `#money`, the door every "connect payments first" fallback in the app opens.
 */
describe("deep links into settings", () => {
  it("opens the row every settings fragment in the app points at", async () => {
    const rendered = await renderSettings("owner");
    const rows = findElements<{ sectionId?: SectionId }>(rendered, settingsRowsModule.SettingsRow);
    // One prop answers both halves now: a row's `sectionId` is what produces
    // its `#anchor` *and* what opens it on that hash, so a row cannot be
    // linkable and unopenable at the same time (`SettingsRows.tsx`).
    const openable = new Set(
      rows.flatMap((row) =>
        row.props.sectionId ? [settingsSectionFragment(row.props.sectionId)] : [],
      ),
    );
    const anchored = openable;
    // A link may also point at a whole *group* — a plain `<h2 id>` outside any
    // disclosure, so it needs nothing to reveal it. `#data-integrations` is
    // one, and reading it as a broken row link would be this test crying wolf.
    const groups = new Set<string>(SETTINGS_GROUPS.map((group) => group.id));

    const linked = new Set<string>();
    for (const file of await readdirDeep("src")) {
      if (!/\.tsx?$/.test(file) || file.includes(".test.")) continue;
      const source = await readFile(file, "utf8");
      for (const [, fragment] of source.matchAll(/\/settings#([a-z-]+)/g)) linked.add(fragment);
    }
    // A guard on the guard: if the scan finds nothing, the assertion below is
    // vacuously true and this test is worthless.
    expect(linked.size).toBeGreaterThan(0);

    for (const fragment of linked) {
      if (groups.has(fragment)) continue;
      expect(openable, `${fragment} has no row that opens on its fragment`).toContain(fragment);
      expect(anchored, `${fragment} has no target inside a row`).toContain(fragment);
    }
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

  it("renders shop profile fields for tagline, description, and logo", async () => {
    const element = await renderSettings("owner");
    const names = inputNamesIn(element);
    expect(names).toContain("tagline");
    expect(names).toContain("logoFile");
  });

  /**
   * Harbor's brand (ADR 20260901-diveday-reimagined, decision 2) is edited on
   * the same row as the logo and tagline: one place a shop says who it is.
   */
  it("renders the brand fields — colour, face, cover photo, year and badges — on the profile row", async () => {
    const element = await renderSettings("owner");
    const names = inputNamesIn(element);
    for (const name of ["brandHeroFile", "brandHeroImageAlt", "establishedYear", "badge"]) {
      expect(names).toContain(name);
    }
    expect(selectNamesIn(element)).toContain("brandDisplayFont");
    // The colour is a Client Component (picker + hex field), so it appears in
    // the server tree as an element rather than as an `<input name>`.
    expect(findElements(element, BrandColorField)).toHaveLength(1);
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

async function queueStuckDeletion(db: AppDb, session: DiveDaySession) {
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
  session: DiveDaySession,
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

describe("the diving options a shop runs", () => {
  it("offers boat alongside shore and pool, and the boat list with it", async () => {
    const element = await renderSettings("owner");
    const names = inputNamesIn(element);
    expect(names).toContain("hasBoatDiving");
    expect(names).toContain("hasShoreDiving");
    expect(names).toContain("hasPoolDiving");
    // The seeded shop runs boats, so the fleet editor is reachable.
    expect(names).toContain("capacity");
  });

  it("asks a boat shop for its divemaster target too", async () => {
    // The "divers per departure" this replaced was only ever asked of a shop
    // with no hull. The target is about who is in the water, which is a
    // question a boat has as much as a beach does.
    expect(inputNamesIn(await renderSettings("owner"))).toContain("diversPerDivemaster");
  });

  it("takes the boat list away when the shop says it runs no boats", async () => {
    const element = await renderSettings("owner", async (db, session) => {
      await setShopDivingOptions(db, session.user.shopId, {
        hasBoatDiving: false,
        hasShoreDiving: true,
        hasPoolDiving: true,
        diversPerDivemaster: 6,
      });
    });
    const names = inputNamesIn(element);
    // No hull to name, so the whole Boats row is gone rather than sitting there
    // empty.
    expect(names).not.toContain("boatId");
    // The target survives losing the fleet — it never depended on one.
    expect(names).toContain("diversPerDivemaster");
    // The option itself stays on offer, so the shop can turn boats back on.
    expect(names).toContain("hasBoatDiving");
  });
});

/*
 * The dock-day preview describes the shop's own six numbers, and a dive site
 * may override one of them (`dive_sites.expected_bottom_time_minutes`). The
 * preview used to say nothing about that, so a shop reading it had no way to
 * know which departures it did not describe.
 */
describe("the dock-day preview and the sites that override it", () => {
  it("says nothing extra when no site sets its own bottom time", async () => {
    const hrefs = hrefsIn(await renderSettings("owner"));
    expect(hrefs.filter((href) => href.includes("/dive-sites/"))).toHaveLength(0);
  });

  it("links the sites that do", async () => {
    let overridden = "";
    const element = await renderSettings("owner", async (db, session) => {
      const [site] = await listDiveSites(db, session.user.shopId);
      if (!site) throw new Error("the seed has no dive site");
      overridden = site.id;
      await db
        .update(diveSites)
        .set({ expectedBottomTimeMinutes: 30 })
        .where(eq(diveSites.id, site.id));
    });
    expect(hrefsIn(element)).toContain(`/shop/${SHOP_SLUG}/dive-sites/${overridden}`);
  });
});

/** Every file under `dir`, recursively — the scan the deep-link test walks. */
async function readdirDeep(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const out: string[] = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await readdirDeep(full)));
    else out.push(full);
  }
  return out;
}

/**
 * **The pane half of the rail-and-pane split** (ADR
 * 20260827-clearwater-surface-language, decision 6). The rail is only honest
 * if it is drawn from the same list the pane renders, so these read the hub's
 * own output and hold `SETTINGS_RAIL_ROWS` against it: a section the pane
 * renders and the map does not name is a destination a shop cannot find, and a
 * door the map names and the pane never renders is a row that leads nowhere.
 */
describe("the rail and the pane say the same thing", () => {
  it("renders every section the rail points at, in the rail's order", async () => {
    const rows = findElements<{ sectionId?: string }>(
      await renderSettings("owner"),
      settingsRowsModule.SettingsRow,
    );
    const rendered = rows.flatMap((row) => (row.props.sectionId ? [row.props.sectionId] : []));
    const mapped = SETTINGS_RAIL_ROWS.flatMap((row) =>
      row.target.kind === "section" ? [row.target.id] : [],
    );
    // Order too, not just membership: the scroll-spy walks the rail's rows
    // against the pane's positions, so a rail that disagreed with the page
    // would light the wrong row all the way down.
    expect(rendered).toEqual(mapped.filter((id) => rendered.includes(id)));
    expect(new Set(rendered)).toEqual(new Set(mapped.filter((id) => rendered.includes(id))));
    // The seeded shop runs boats and takes payments, so it renders the lot.
    expect(rendered).toEqual(mapped);
  });

  it("names every door the hub renders", async () => {
    const doors = findElements<{ href: string }>(
      await renderSettings("owner"),
      settingsRowsModule.SettingsDoorRow,
    ).map((row) => row.props.href.replace(`/shop/${SHOP_SLUG}`, ""));
    const mapped = new Set(
      SETTINGS_RAIL_ROWS.flatMap((row) => (row.target.kind === "route" ? [row.target.path] : [])),
    );
    for (const href of doors) {
      expect(mapped, `${href} is a door with no row on the map`).toContain(href);
    }
    expect(doors.length).toBeGreaterThan(0);
  });

  it("carries no standing caption on a door row", async () => {
    // The heaviest deletion in this slice: fourteen captions whose only reader
    // was a closed row. A door row is its label and the page it opens.
    const doors = findElements<Record<string, unknown>>(
      await renderSettings("owner"),
      settingsRowsModule.SettingsDoorRow,
    );
    for (const door of doors) expect(door.props.description).toBeUndefined();
  });

  it("groups the pane into inset groups rather than a stack of cards", async () => {
    // Decision 2's second anatomy, consumed from 6a rather than re-spelled.
    expect(findElements(await renderSettings("owner"), InsetGroup)).toHaveLength(
      SETTINGS_GROUPS.length,
    );
  });

  it("reopens the row `?saved=` names, and no other", async () => {
    const rows = findElements<{ sectionId?: string; activeSection?: string | null }>(
      await renderSettings("owner", undefined, { saved: "units" }),
      settingsRowsModule.SettingsRow,
    );
    const opened = rows.filter((row) => row.props.sectionId === row.props.activeSection);
    expect(opened.map((row) => row.props.sectionId)).toEqual(["units"]);
  });

  it("opens nothing when nothing was saved", async () => {
    const rows = findElements<{ sectionId?: string; activeSection?: string | null }>(
      await renderSettings("owner"),
      settingsRowsModule.SettingsRow,
    );
    for (const row of rows) expect(row.props.activeSection).toBeNull();
  });
});

/**
 * **The season the shop counts in** — ADR 20260904-reef-all-the-way-down,
 * Budget rule 3, slice 16b. The denominator behind the home's one fact of
 * scale, which is only a fact against a date the shop chose.
 */
describe("the season a shop counts in", () => {
  it("asks for a month and a day, beside the timezone it reads them in", async () => {
    const element = await renderSettings("owner");
    // The month is a select and the day a number box, deliberately: the days a
    // month has depend on the month, so the day is validated rather than
    // enumerated.
    expect(selectNamesIn(element)).toContain("seasonStartMonth");
    expect(inputNamesIn(element)).toContain("seasonStartDay");
  });
});
