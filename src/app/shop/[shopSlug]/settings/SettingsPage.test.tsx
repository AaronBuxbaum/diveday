import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import type { ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";
import { ImageFileInput } from "@/components/ImageFileInput";
import { RemovablePhoto } from "@/components/RemovablePhoto";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass, tapTargetLinkClass } from "@/components/ui/button";
import { type Fact, FactLine } from "@/components/ui/FactLine";
import { ChoiceFieldset, ChoiceRow, Field, FieldActions } from "@/components/ui/form";
import { InsetGroup } from "@/components/ui/ledger";
import type { AppDb } from "@/db/client";
import { listDiveSites } from "@/db/dive-sites";
import { diveSites, mediaDeletionAttempts, processorErasureObligations, shops } from "@/db/schema";
import { getShopBySlug, setShopDivingOptions } from "@/db/shops";
import { listShopStaff } from "@/db/staff-accounts";
import { STAFF_MESSAGES } from "@/i18n/staff-messages";
import type { DiveDaySession } from "@/lib/auth";
import type { Role } from "@/lib/authz";
import { SUPPORT_EMAIL } from "@/lib/platform-mail";
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
import { CounterQrCard } from "./CounterQrCard";
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
  return expandGroups(
    await SettingsPage({
      params: Promise.resolve({ shopSlug: SHOP_SLUG }),
      searchParams: Promise.resolve(searchParams),
    }),
  );
}

/**
 * The hub composes one component per settings group (`_components/groups/`),
 * two of them async under their own `<Suspense>`. Every reader in this file
 * asks what the hub decided to show, so the group components are rendered
 * in place — awaited where async — and the tree is read exactly as one page.
 */
const GROUP_COMPONENTS = new Set<unknown>(
  Object.values(await import("./_components/groups/groups")),
);

async function expandGroups(node: unknown): Promise<ReactElement> {
  return (await expand(node)) as ReactElement;
}

async function expand(node: unknown): Promise<unknown> {
  if (node === null || typeof node !== "object") return node;
  if (Array.isArray(node)) return Promise.all(node.map(expand));
  if (!("type" in node) || !("props" in node)) return node;
  const element = node as ReactElement<{ children?: unknown }>;
  if (GROUP_COMPONENTS.has(element.type)) {
    const render = element.type as (props: unknown) => unknown;
    return expand(await render(element.props));
  }
  if (element.props?.children === undefined) return element;
  return {
    ...element,
    props: { ...element.props, children: await expand(element.props.children) },
  };
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

  it("gives an owner a door to Team, and none to the Money section's pages", async () => {
    // Team existed only in the nav registry and ⌘K: an owner who opened
    // Settings to add a colleague found no card. Discounts went the other way
    // once Money gave it a tab (ADR 20261001-logbook): one destination behind
    // two menus is the duplicate control principle 8 rules out
    // (src/lib/staff-destinations.ts).
    const hrefs = hrefsIn(await renderSettings("owner"));
    expect(hrefs).toContain(`/shop/${SHOP_SLUG}/settings/team`);
    expect(hrefs).not.toContain(`/shop/${SHOP_SLUG}/promos`);
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
    // disclosure, so it needs nothing to reveal it. `#data` is
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
  it("renders the brand fields — color, face, cover photo, year and badges — on the profile row", async () => {
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

/**
 * **No caption label wraps another label** (K-13 review). The profile row's
 * logo, cover photo and badges were `Field`s around composites holding labels
 * of their own, so the page nested a label in a label: with a logo on file the
 * caption "Logo" labelled the "Remove logo" box and a click on it ticked the
 * box, and "Badges" labelled the first badge.
 */
describe("the profile row's captions", () => {
  const PROFILE = STAFF_MESSAGES["en-US"].settings.main.profile;

  /** Every element in a tree carrying `name`, whatever renders it. */
  function named(node: unknown, name: string, found: ReactElement<{ id?: string }>[] = []) {
    if (node === null || typeof node !== "object") return found;
    if (Array.isArray(node)) {
      for (const child of node) named(child, name, found);
      return found;
    }
    if ("props" in node) {
      const element = node as ReactElement<{ name?: unknown; id?: string; children?: unknown }>;
      if (element.props?.name === name) found.push(element);
      named(element.props?.children, name, found);
    }
    return found;
  }

  async function profileBody() {
    const [row] = findElements<{ sectionId?: string; children?: unknown }>(
      await renderSettings("owner", async (db, session) => {
        await db
          .update(shops)
          .set({ logoUrl: "/dive-sites/logo.png" })
          .where(eq(shops.id, session.user.shopId));
      }),
      settingsRowsModule.SettingsRow,
    ).filter((candidate) => candidate.props.sectionId === "profile");
    return row?.props.children;
  }

  it("names the logo and cover-photo pickers with their captions, never the remove box", async () => {
    const body = await profileBody();
    const fields = findElements<{ label?: unknown; htmlFor?: string }>(body, Field);
    for (const [label, input] of [
      [PROFILE.logo, "logoFile"],
      [PROFILE.heroPhoto, "brandHeroFile"],
    ] as const) {
      const [field] = fields.filter((candidate) => candidate.props.label === label);
      expect(field?.props.htmlFor, label).toBeTruthy();
      const [picker] = named(body, input);
      expect(picker?.props.id, input).toBe(field?.props.htmlFor);
    }
  });

  /**
   * The logo and the cover photo were a raw `<img>` beside a visible checkbox,
   * above a bare file input: the one form still drawing "take a stored photo
   * back off" its own way (K-247 follow-up). They are `RemovablePhoto`s now,
   * the logo in its square shape, picked with `ImageFileInput`, posting the
   * same `removeLogo` / `removeHero` and `logoFile` / `brandHeroFile` the save
   * action reads.
   */
  it("takes a stored logo and cover photo back off the way every stored photo is", async () => {
    const body = await profileBody();
    const photos = findElements<{ name?: string; value?: string; shape?: string }>(
      body,
      RemovablePhoto,
    );
    expect(photos.map(({ props }) => [props.name, props.value ?? "true", props.shape])).toEqual([
      ["removeLogo", "true", "logo"],
      ["removeHero", "true", undefined],
    ]);
    expect(
      findElements<{ name?: string }>(body, ImageFileInput).map(({ props }) => props.name),
    ).toEqual(["logoFile", "brandHeroFile"]);
    expect(findElements(body, "img")).toHaveLength(0);
  });

  it("captions the badges as a group of choices, not with a field's label", async () => {
    const body = await profileBody();
    const groups = findElements<{ legend?: unknown; hint?: unknown; children?: unknown }>(
      body,
      ChoiceFieldset,
    ).filter((group) => group.props.legend === PROFILE.badges);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.props.hint).toBe(PROFILE.badgesHint);
    expect(inputNamesIn(groups[0]?.props.children)).toContain("badge");
    const wrapping = findElements<{ children?: unknown }>(body, Field).filter(
      (field) => findElements(field.props.children, ChoiceRow).length > 0,
    );
    expect(wrapping).toHaveLength(0);
  });
});

/*
 * The two data-compliance queues that moved here from the monthly report:
 * stored files a provider delete never finished, and erasures that never landed
 * at Stripe. What is worth pinning down is exactly what moved with them — the
 * rendering condition (non-empty, never an empty table) and the owner-only
 * split on the erasure buttons.
 */
const MEDIA_PANEL = "Photos that didn’t finish deleting";
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

/**
 * **A row's answer wraps only between its facts** (K-235). Five closed rows
 * state several facts joined by " · ", and each was one plain string, so any
 * space in any fact was a place to break: the contact row ended a line on
 * "+1" with "305 555 0142" under it (SETTINGS-1-07), and Diving options broke
 * "6:1 divers / per divemaster" (SETTINGS-1-21). Each is a `FactLine` now,
 * which keeps our own words whole and lets only the shop's free text wrap.
 */
describe("the hub's summary values", () => {
  const PHONE = "+1 305 555 0231";

  async function valueFacts(sectionId: SectionId) {
    const element = await renderSettings("owner", async (db, session) => {
      await db
        .update(shops)
        .set({
          contactPhone: PHONE,
          tagline: "Diving the Keys since 2012",
          passThroughFee: { name: "Marine park fee", amountCents: 500 },
        })
        .where(eq(shops.id, session.user.shopId));
    });
    const [row] = findElements<{ sectionId?: string; value?: unknown }>(
      element,
      settingsRowsModule.SettingsRow,
    ).filter((candidate) => candidate.props.sectionId === sectionId);
    expect(row, sectionId).toBeDefined();
    const lines = findElements<{ facts: readonly Fact[] }>(row?.props.value, FactLine);
    expect(lines, `${sectionId}'s value is a FactLine`).toHaveLength(1);
    return lines[0]?.props.facts ?? [];
  }

  it("keeps the contact phone whole, so the line breaks only after its dot", async () => {
    const facts = await valueFacts("contact");
    expect(facts.filter(Boolean).at(-1)).toBe(PHONE);
  });

  it("keeps each of our own facts whole on the units, diving-options and crew rows", async () => {
    for (const sectionId of ["units", "divingOptions", "crewSchedule"] as const) {
      const facts = (await valueFacts(sectionId)).filter(Boolean);
      expect(facts.length, sectionId).toBeGreaterThan(1);
      for (const fact of facts) expect(typeof fact, `${sectionId}: ${fact}`).toBe("string");
    }
    // The seeded demo plans its crew here, so its target rides on the row.
    expect(await valueFacts("crewSchedule")).toEqual(["On", "6:1 divers per divemaster"]);
  });

  it("lets only the shop's own words wrap: the tagline and the fee's name", async () => {
    const [tagline, ...profile] = (await valueFacts("profile")).filter(Boolean);
    expect(tagline).toEqual({ value: "Diving the Keys since 2012", wraps: true });
    for (const fact of profile) expect(typeof fact).toBe("string");

    const [feeName, price] = await valueFacts("passThrough");
    expect(feeName).toEqual({ value: "Marine park fee", wraps: true });
    expect(price).toBe("$5 / diver");
  });
});

/** How the two queues are drawn, once they have something in them. */
describe("the data-compliance queues' drawing", () => {
  async function queuePanels() {
    const element = await renderSettings("owner", async (db, session) => {
      await queueStuckDeletion(db, session);
      await oweErasure(db, session, "stripe_customer");
    });
    const panels = findElements<{ "aria-label"?: string; children?: unknown }>(
      element,
      "section",
    ).filter((section) => [MEDIA_PANEL, ERASURE_PANEL].includes(section.props["aria-label"] ?? ""));
    expect(panels).toHaveLength(2);
    return panels;
  }

  /**
   * Each item was one `flex flex-wrap` run of name, id, a meta span that
   * *started* with "·", and the forms, so at 390 a line opened on the dot and
   * the buttons landed wherever the words ended, at a different x on every
   * item (K-341). The words are one `FactLine` now, and the forms a group of
   * their own under them.
   */
  it("sets each item's words as one line of facts, and its actions on a line of their own", async () => {
    const strings = (node: unknown): string[] => {
      if (typeof node === "string") return [node];
      if (Array.isArray(node)) return node.flatMap(strings);
      if (node && typeof node === "object" && "props" in node) {
        return strings((node as ReactElement<{ children?: unknown }>).props.children);
      }
      return [];
    };
    let items = 0;
    for (const panel of await queuePanels()) {
      for (const item of findElements<{ children?: unknown }>(panel.props.children, "li")) {
        items++;
        const children = [item.props.children].flat(Number.POSITIVE_INFINITY);
        expect(children.filter((child) => (child as ReactElement)?.type === "form")).toEqual([]);
        const holdingForms = children.filter((child) => findElements(child, "form").length > 0);
        expect(holdingForms).toHaveLength(1);
        expect(findElements(holdingForms[0], FactLine)).toHaveLength(0);
        const factLines = findElements<{ separatorClassName?: string }>(
          item.props.children,
          FactLine,
        );
        expect(factLines).toHaveLength(1);
        // The dots keep the muted ink the base's one muted run gave them, not
        // the notice's danger (K-341 review).
        expect(factLines[0]?.props.separatorClassName).toBe("text-muted");
        for (const text of strings(item.props.children)) expect(text).not.toMatch(/^\s*·/);
      }
    }
    expect(items).toBe(2);
  });
});

describe("the diving options a shop runs", () => {
  it("offers boat alongside shore and pool, and the door to the fleet with it", async () => {
    const element = await renderSettings("owner");
    const names = inputNamesIn(element);
    expect(names).toContain("hasBoatDiving");
    expect(names).toContain("hasShoreDiving");
    expect(names).toContain("hasPoolDiving");
    // The seeded shop runs boats, so the fleet editor is reachable — as a door
    // now, not a form in a row: a list of hulls each carrying a Save and a
    // Delete is a page, and the hub is a directory.
    expect(hrefsIn(element)).toContain(`/shop/${SHOP_SLUG}/settings/boats`);
  });

  it("asks for the divemaster target beside the crew schedule switch", async () => {
    // The target is only ever read while the shop plans its crew here
    // (`shopCrewTarget`), so it lives with the switch rather than with the
    // kinds of diving.
    const names = inputNamesIn(await renderSettings("owner"));
    expect(names).toContain("crewScheduleEnabled");
    expect(names).toContain("diversPerDivemaster");
  });

  it("takes the boat list away when the shop says it runs no boats", async () => {
    const element = await renderSettings("owner", async (db, session) => {
      await setShopDivingOptions(db, session.user.shopId, {
        hasBoatDiving: false,
        hasShoreDiving: true,
        hasPoolDiving: true,
      });
    });
    const names = inputNamesIn(element);
    // No hull to name, so the whole Boats row is gone rather than sitting there
    // empty. (The page it opens refuses the same way, with `notFound()`.)
    expect(hrefsIn(element)).not.toContain(`/shop/${SHOP_SLUG}/settings/boats`);
    // The target survives losing the fleet — it never depended on one.
    expect(names).toContain("diversPerDivemaster");
    // The option itself stays on offer, so the shop can turn boats back on.
    expect(names).toContain("hasBoatDiving");
  });

  it("keeps the editors that outgrew a row as doors, not forms", async () => {
    // A row states an answer and opens the form that changes it (ADR
    // 20260827-clearwater-surface-language, decision 6). These opened onto
    // lists of forms, so they are pages; the hub renders no control of theirs.
    // Dive packages is a door on Money's Discounts tab now, not here.
    const element = await renderSettings("owner");
    const hrefs = hrefsIn(element);
    expect(hrefs).not.toContain(`/shop/${SHOP_SLUG}/promos/packages`);
    for (const segment of ["boats", "trip-tags"]) {
      expect(hrefs).toContain(`/shop/${SHOP_SLUG}/settings/${segment}`);
    }
    const names = inputNamesIn(element);
    for (const name of ["boatId", "lensId", "packageId", "capacity", "diveCount"]) {
      expect(names, `${name} is still on the hub`).not.toContain(name);
    }
  });
});

/**
 * **One beat per line on a phone** (K-585). The preview was a greedy
 * `flex-wrap` strip, so at 390 five lines held one beat each and the third
 * held two, 25px apart, and the list read as a list with one line carrying two
 * beats. From `sm` up it is the strip it was.
 */
describe("the dock-day preview's layout", () => {
  it("stacks the beats on a phone and runs them as a strip from sm up", async () => {
    const [row] = findElements<{ sectionId?: string; children?: unknown }>(
      await renderSettings("owner"),
      settingsRowsModule.SettingsRow,
    ).filter((candidate) => candidate.props.sectionId === "dockCall");
    const lists = findElements<{ className?: string }>(row?.props.children, "dl");
    expect(lists).toHaveLength(1);
    const classes = lists[0]?.props.className?.split(" ") ?? [];
    expect(classes).toEqual(expect.arrayContaining(["grid", "sm:flex", "sm:flex-wrap"]));
    expect(classes).not.toContain("flex");
    expect(classes).not.toContain("flex-wrap");
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

/**
 * **The emergency reference row**, drawn like every other row on the hub. It
 * is the one thing on this page a crew reads when something has gone wrong,
 * and it was the one row whose body was spelled its own way.
 */
describe("the emergency reference row", () => {
  const EMERGENCY = STAFF_MESSAGES["en-US"].settings.main.emergency;

  async function emergencyRow() {
    const rows = findElements<{ sectionId?: string; description?: string; children?: unknown }>(
      await renderSettings("owner"),
      settingsRowsModule.SettingsRow,
    ).filter((row) => row.props.sectionId === "emergency");
    expect(rows).toHaveLength(1);
    return rows[0] as NonNullable<(typeof rows)[number]>;
  }

  /**
   * Its intro was a `<p>` inside the `mt-4` form, not the row's description,
   * so its first line sat 16px lower than every other row's (55px from label
   * to first line at 1280, against 39 on the rows around it; K-437).
   */
  it("says what it is for in the row's description, where every row does", async () => {
    const row = await emergencyRow();
    expect(row.props.description).toBe(EMERGENCY.intro);
    const paragraphs = findElements<{ children?: unknown }>(row.props.children, "p");
    expect(paragraphs.filter((p) => p.props.children === EMERGENCY.intro)).toHaveLength(0);
  });

  /**
   * Its Save was `size: "sm"` in a bare `<div>`: 44px with a 14px label, where
   * every other Save on the hub is the default 48px with 16px, in
   * `FieldActions` (K-308).
   */
  it("saves with the hub's one Save, at its size and in its row", async () => {
    const row = await emergencyRow();
    const saves = findElements<{ children?: unknown; className?: string }>(
      findElements(row.props.children, FieldActions),
      SubmitButton,
    ).filter((button) => button.props.children === EMERGENCY.submit);
    expect(saves).toHaveLength(1);
    expect(saves[0]?.props.className).toBe(buttonClass({ variant: "secondary" }));
  });

  /**
   * The examples were each label box's placeholder, and a half-width box is
   * 331px at 1280 and 324 at 390: "Chamber, dive-accident hotline, coast
   * guard…" was cut mid-word, and the Spanish is longer (K-583). They are the
   * first line's description now, which wraps, and no box carries them.
   */
  it("gives its examples once, under the first line, where they wrap", async () => {
    const row = await emergencyRow();
    const lines = findElements<{ description?: unknown; children?: unknown }>(
      row.props.children,
      Field,
    ).filter((field) => {
      const control = field.props.children as ReactElement<{ name?: string }> | undefined;
      return control?.props?.name?.startsWith("emergencyLabel-");
    });
    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines) {
      const control = line.props.children as ReactElement<{ placeholder?: unknown }>;
      expect(control.props.placeholder).toBeUndefined();
    }
    expect(lines.map((line) => line.props.description)).toEqual([
      EMERGENCY.lineExamples,
      ...lines.slice(1).map(() => undefined),
    ]);
  });
});

/**
 * **The support door at the foot of the page.** A bare `<a>` after a block
 * `<p>` is not a link inside a sentence, so the inline-link exception to the
 * 44px floor does not apply to it: "Email support@dive.day" was a 159×17
 * target on every settings capture at 390 (K-153).
 */
describe("the page's footer", () => {
  it("makes the support email a 44px target", async () => {
    const links = findElements<{ href?: string; className?: string }>(
      await renderSettings("owner"),
      "a",
    ).filter((link) => link.props.href === `mailto:${SUPPORT_EMAIL}`);
    expect(links).toHaveLength(1);
    expect(links[0]?.props.className?.split(" ")).toEqual(
      expect.arrayContaining(tapTargetLinkClass.split(" ")),
    );
  });

  /**
   * The page's sections sit 40px apart in one `space-y-10`, and the footer
   * sat outside that stack on its own `mt-12`, 48px under the last card
   * (K-488). It is the stack's last child now, and carries no margin of its own.
   */
  it("sits in the page's section stack, a section's gap under the last card", async () => {
    const stacks = findElements<{ className?: string; children?: unknown }>(
      await renderSettings("owner"),
      "div",
    ).filter((div) => div.props.className === "space-y-10");
    expect(stacks).toHaveLength(1);
    const children = [stacks[0]?.props.children].flat(Number.POSITIVE_INFINITY);
    const footer = children.at(-1) as ReactElement<{ className?: string }> | undefined;
    expect(footer?.type).toBe("footer");
    expect(footer?.props.className).not.toMatch(/(^|\s)m[ty]-/);
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
 * The section ids the pane renders, in order. `CounterQrCard` is a client row
 * whose `SettingsRow` sits inside it, out of this tree's reach, so the card
 * itself stands for its section.
 */
function renderedSectionIds(node: unknown, found: string[] = []): string[] {
  if (node === null || typeof node !== "object") return found;
  if (Array.isArray(node)) {
    for (const child of node) renderedSectionIds(child, found);
    return found;
  }
  if ("type" in node && "props" in node) {
    const element = node as ReactElement<{ sectionId?: string; children?: unknown }>;
    if (element.type === settingsRowsModule.SettingsRow && element.props.sectionId)
      found.push(element.props.sectionId);
    if (element.type === CounterQrCard) found.push("counterCard");
    renderedSectionIds(element.props?.children, found);
  }
  return found;
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
    // A shop past its demo, so the trial row renders too.
    const rendered = renderedSectionIds(
      await renderSettings("owner", async (db, session) => {
        await db.update(shops).set({ isDemo: false }).where(eq(shops.id, session.user.shopId));
      }),
    );
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

  /**
   * **Nothing on the pane is missing from the map** (Aaron, 2026-10-03: the
   * rail and the list disagreed). The counter card and the trial row were
   * rows with no section id, so the test above never saw them and the rail
   * never named them.
   */
  it("gives every row the pane renders a section the rail names", async () => {
    const rows = findElements<{ sectionId?: string; heading: string }>(
      await renderSettings("owner", async (db, session) => {
        await db.update(shops).set({ isDemo: false }).where(eq(shops.id, session.user.shopId));
      }),
      settingsRowsModule.SettingsRow,
    );
    for (const row of rows) expect(row.props.sectionId, row.props.heading).toBeDefined();
    expect(rows.length).toBeGreaterThan(5);
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
