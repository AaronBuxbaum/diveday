import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppDb } from "@/db/client";
import { people, personRoles, userAccounts } from "@/db/schema";
import { listShopStaff } from "@/db/staff-accounts";
import type { Role } from "@/lib/authz";
import { seededShopContext } from "@/test/db";
import {
  redirectedTo,
  SEEDED_CAPTAIN_EMAIL,
  SEEDED_OWNER_EMAIL,
  seededStaffPersonId,
  staffSession,
} from "@/test/staff-session";

/**
 * Team management is the gate over the gates: whoever can edit roles here can
 * hand themselves every other H-14 surface — refunds, erasure, pricing — on the
 * next request. So a captain reaching `saveStaffRolesAction` with a hand-made
 * form post is the privilege-escalation path in this codebase, and
 * `teamManagementBlock()` is the only thing closing it.
 *
 * `src/db/staff-accounts.ts` has no gate of its own — `setStaffRoles` and
 * `removeStaffMember` write whatever they are given. Every test below therefore
 * checks the `person_roles` / `user_accounts` rows after the refusal, not just
 * the notice.
 */

vi.mock("next/navigation", () => ({
  redirect: vi.fn((to: string) => {
    throw new Error(`REDIRECT:${to}`);
  }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/db/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db/client")>();
  return { ...actual, getDb: vi.fn() };
});
vi.mock("@/lib/session", () => ({ requireStaffSession: vi.fn() }));

const { getDb } = await import("@/db/client");
const { requireStaffSession } = await import("@/lib/session");
const {
  removeStaffAction,
  saveStaffEmergencyContactAction,
  saveStaffRolesAction,
  setStaffStatusAction,
} = await import("./actions");

async function rolesOf(db: AppDb, personId: string): Promise<Role[]> {
  const rows = await db
    .select({ role: personRoles.role })
    .from(personRoles)
    .where(eq(personRoles.personId, personId));
  return rows.map((row) => row.role as Role).sort();
}

async function accountStatusOf(db: AppDb, personId: string): Promise<string> {
  const [row] = await db
    .select({ status: userAccounts.status })
    .from(userAccounts)
    .where(eq(userAccounts.personId, personId));
  if (!row) throw new Error("staff account missing");
  return row.status;
}

/**
 * One row's roles disclosure, as it posts when it closes: the person it is
 * about, and one `role_<role>` per box left ticked (ADR
 * 20260827-the-shops-shelves, slice 9h — the page-level "Save changes" that
 * batched every row into one submit is gone).
 */
function rolesForm(personId: string, roles: Role[], extra: Record<string, string> = {}): FormData {
  const formData = new FormData();
  formData.set("personId", personId);
  for (const role of roles) formData.set(`role_${role}`, "on");
  for (const [key, value] of Object.entries(extra)) formData.set(key, value);
  return formData;
}

async function context() {
  const { db, shop } = await seededShopContext();
  vi.mocked(getDb).mockResolvedValue(db);
  return {
    db,
    shop,
    owner: await seededStaffPersonId(db, shop.id, SEEDED_OWNER_EMAIL),
    captain: await seededStaffPersonId(db, shop.id, SEEDED_CAPTAIN_EMAIL),
  };
}

function signIn(shop: { id: string; slug: string }, personId: string) {
  vi.mocked(requireStaffSession).mockResolvedValue(
    staffSession({ shopId: shop.id, shopSlug: shop.slug, personId }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("editing the team's roles", () => {
  it("refuses a captain who posts himself an owner role — this is the escalation path", async () => {
    const { db, shop, captain } = await context();
    signIn(shop, captain);
    const formData = rolesForm(captain, ["owner", "manager"]);

    const to = await redirectedTo(() => saveStaffRolesAction(formData));

    expect(to).toBe(`/shop/${shop.slug}/settings/team?notice=not-authorized`);
    expect(await rolesOf(db, captain)).toEqual(["captain"]);
  });

  it("refuses a captain who posts the owner *out* of her own roles", async () => {
    const { db, shop, captain, owner } = await context();
    signIn(shop, captain);
    const formData = rolesForm(owner, ["crew"]);

    const to = await redirectedTo(() => saveStaffRolesAction(formData));

    expect(to).toBe(`/shop/${shop.slug}/settings/team?notice=not-authorized`);
    expect(await rolesOf(db, owner)).toEqual(["manager", "owner"]);
  });

  // The 9h round-trip: one row's close is one row's save, and the answer names
  // the row it is about so nothing lands in a page banner.
  it("saves one row and answers on that row, carrying its Undo", async () => {
    const { db, shop, captain, owner } = await context();
    signIn(shop, owner);

    const to = await redirectedTo(() =>
      saveStaffRolesAction(rolesForm(captain, ["captain", "divemaster"])),
    );

    expect(to).toBe(
      `/shop/${shop.slug}/settings/team?notice=changes-saved&rolesFor=${captain}&priorRoles=captain#staff-${captain}`,
    );
    expect(await rolesOf(db, captain)).toEqual(["captain", "divemaster"]);
  });

  it("leaves every other row alone — a row's save is only ever its own", async () => {
    const { db, shop, captain, owner } = await context();
    signIn(shop, owner);
    const ownerRolesBefore = await rolesOf(db, owner);

    await redirectedTo(() => saveStaffRolesAction(rolesForm(captain, ["crew"])));

    expect(await rolesOf(db, owner)).toEqual(ownerRolesBefore);
  });

  it("undoes in exactly one re-save, and offers no undo back", async () => {
    const { db, shop, captain, owner } = await context();
    signIn(shop, owner);
    await redirectedTo(() => saveStaffRolesAction(rolesForm(captain, ["crew"])));
    expect(await rolesOf(db, captain)).toEqual(["crew"]);

    // What the row's Undo posts: the pre-save roles the redirect handed back,
    // plus the flag that stops the chain.
    const to = await redirectedTo(() =>
      saveStaffRolesAction(rolesForm(captain, ["captain"], { undo: "1" })),
    );

    expect(await rolesOf(db, captain)).toEqual(["captain"]);
    expect(to).toBe(
      `/shop/${shop.slug}/settings/team?notice=changes-saved&rolesFor=${captain}#staff-${captain}`,
    );
    expect(to).not.toContain("priorRoles");
  });

  it("offers no Undo for a save that changed nothing", async () => {
    const { db, shop, captain, owner } = await context();
    signIn(shop, owner);

    const to = await redirectedTo(() => saveStaffRolesAction(rolesForm(captain, ["captain"])));

    expect(to).not.toContain("priorRoles");
    expect(await rolesOf(db, captain)).toEqual(["captain"]);
  });

  // The two refusals a row's disclosure can produce. Both name the row, and
  // both carry the fragment that puts the reader back on it — the page banner
  // never sees either (./notices.test.ts holds the routing half).
  it("refuses an empty row on the row itself, writing nothing", async () => {
    const { db, shop, captain, owner } = await context();
    signIn(shop, owner);

    const to = await redirectedTo(() => saveStaffRolesAction(rolesForm(captain, [])));

    expect(to).toBe(
      `/shop/${shop.slug}/settings/team?notice=roles-invalid&rolesFor=${captain}#staff-${captain}`,
    );
    expect(await rolesOf(db, captain)).toEqual(["captain"]);
  });

  // The lost update. `setStaffRoles` is a delete-then-insert of the whole staff
  // subset, so without a baseline the second of two people with this page open
  // silently reverts the first — on the one surface where what gets reverted is
  // who may reach every other gated surface in the shop. Refused, not merged:
  // the same answer `ConflictGuardedForm` gives the course editor (issue #820).
  it("refuses a close whose baseline is no longer the row's roles, writing nothing", async () => {
    const { db, shop, captain, owner } = await context();
    signIn(shop, owner);
    // Somebody else got there first: the captain is a divemaster now.
    await redirectedTo(() => saveStaffRolesAction(rolesForm(captain, ["captain", "divemaster"])));

    // This row was rendered before that, and still believes "captain".
    const to = await redirectedTo(() =>
      saveStaffRolesAction(rolesForm(captain, ["captain", "crew"], { baseline: "captain" })),
    );

    expect(to).toBe(
      `/shop/${shop.slug}/settings/team?notice=roles-conflict&rolesFor=${captain}#staff-${captain}`,
    );
    expect(await rolesOf(db, captain)).toEqual(["captain", "divemaster"]);
  });

  it("writes when the baseline still is the row's roles, whatever order it arrives in", async () => {
    const { db, shop, owner } = await context();
    signIn(shop, owner);

    const to = await redirectedTo(() =>
      saveStaffRolesAction(
        rolesForm(owner, ["owner", "manager", "captain"], { baseline: "owner,manager" }),
      ),
    );

    expect(to).toContain("notice=changes-saved");
    expect(await rolesOf(db, owner)).toEqual(["captain", "manager", "owner"]);
  });

  it("refuses an Undo left on screen while somebody else edited the same person", async () => {
    const { db, shop, captain, owner } = await context();
    signIn(shop, owner);
    // The save whose answer offered the Undo: the row held "captain" before it.
    await redirectedTo(() => saveStaffRolesAction(rolesForm(captain, ["crew"])));
    // Then somebody else moved, and that Undo button is still on screen.
    await redirectedTo(() =>
      saveStaffRolesAction(rolesForm(captain, ["instructor"], { baseline: "crew" })),
    );

    const to = await redirectedTo(() =>
      saveStaffRolesAction(rolesForm(captain, ["captain"], { undo: "1", baseline: "crew" })),
    );

    expect(to).toBe(
      `/shop/${shop.slug}/settings/team?notice=roles-conflict&rolesFor=${captain}#staff-${captain}`,
    );
    expect(await rolesOf(db, captain)).toEqual(["instructor"]);
  });

  it("refuses the last owner on the owner's own row, writing nothing", async () => {
    const { db, shop, owner } = await context();
    signIn(shop, owner);

    const to = await redirectedTo(() => saveStaffRolesAction(rolesForm(owner, ["manager"])));

    expect(to).toBe(
      `/shop/${shop.slug}/settings/team?notice=last-owner&rolesFor=${owner}#staff-${owner}`,
    );
    expect(await rolesOf(db, owner)).toEqual(["manager", "owner"]);
  });
});

describe("disabling and removing a teammate's access", () => {
  it("refuses a captain trying to disable the owner's login", async () => {
    const { db, shop, captain, owner } = await context();
    const staff = await listShopStaff(db, shop.id);
    const ownerMember = staff.find((member) => member.personId === owner);
    if (!ownerMember) throw new Error("seeded owner is not on the team list");
    signIn(shop, captain);
    const formData = new FormData();
    formData.set("personId", owner);
    formData.set("userAccountId", ownerMember.userAccountId);
    formData.set("status", "disabled");

    const to = await redirectedTo(() => setStaffStatusAction(formData));

    expect(to).toBe(`/shop/${shop.slug}/settings/team?notice=not-authorized`);
    expect(await accountStatusOf(db, owner)).toBe("active");
  });

  it("refuses a captain trying to remove the owner from the team", async () => {
    const { db, shop, captain, owner } = await context();
    const staff = await listShopStaff(db, shop.id);
    const ownerMember = staff.find((member) => member.personId === owner);
    if (!ownerMember) throw new Error("seeded owner is not on the team list");
    signIn(shop, captain);
    const formData = new FormData();
    formData.set("personId", owner);
    formData.set("userAccountId", ownerMember.userAccountId);
    formData.set("fullName", ownerMember.fullName);

    const to = await redirectedTo(() => removeStaffAction(formData));

    expect(to).toBe(`/shop/${shop.slug}/settings/team?notice=not-authorized`);
    expect(await rolesOf(db, owner)).toEqual(["manager", "owner"]);
    expect(await accountStatusOf(db, owner)).toBe("active");
  });

  it("lets an owner disable a teammate's login", async () => {
    const { db, shop, captain, owner } = await context();
    const staff = await listShopStaff(db, shop.id);
    const captainMember = staff.find((member) => member.personId === captain);
    if (!captainMember) throw new Error("seeded captain is not on the team list");
    signIn(shop, owner);
    const formData = new FormData();
    formData.set("personId", captain);
    formData.set("userAccountId", captainMember.userAccountId);
    formData.set("status", "disabled");

    const to = await redirectedTo(() => setStaffStatusAction(formData));

    expect(to).toBe(`/shop/${shop.slug}/settings/team?notice=disabled`);
    expect(await accountStatusOf(db, captain)).toBe("disabled");
  });
});

describe("editing a teammate's emergency contact", () => {
  // Personal data about a colleague, so it sits behind the same gate as roles
  // and account status rather than being writable by anyone who can reach the
  // settings page. `setStaffEmergencyContact` has no gate of its own, so the
  // assertion is on the stored row, not the notice.
  async function contactOf(db: AppDb, personId: string) {
    const [row] = await db
      .select({
        name: people.emergencyContactName,
        phone: people.emergencyContactPhone,
      })
      .from(people)
      .where(eq(people.id, personId));
    return row ?? null;
  }

  function contactForm(personId: string, name: string, phone: string): FormData {
    const formData = new FormData();
    formData.set("personId", personId);
    formData.set("emergencyContactName", name);
    formData.set("emergencyContactPhone", phone);
    return formData;
  }

  it("refuses a captain editing the owner's contact", async () => {
    const { db, shop, captain, owner } = await context();
    signIn(shop, captain);
    // Asserted as *unchanged* rather than empty: the demo seed gives its people
    // contacts, so "still null" would pass for the wrong reason on a row that
    // was never null.
    const before = await contactOf(db, owner);

    const to = await redirectedTo(() =>
      saveStaffEmergencyContactAction(contactForm(owner, "Mallory", "+1-305-555-0000")),
    );

    expect(to).toBe(`/shop/${shop.slug}/settings/team?notice=not-authorized`);
    expect(await contactOf(db, owner)).toEqual(before);
  });

  it("refuses a captain editing his own", async () => {
    // Not a self-service field: the gate is about who may read and write staff
    // personal data on this page, not about whose row it is.
    const { db, shop, captain } = await context();
    signIn(shop, captain);
    const before = await contactOf(db, captain);

    const to = await redirectedTo(() =>
      saveStaffEmergencyContactAction(contactForm(captain, "Marta", "+1-305-555-0114")),
    );

    expect(to).toBe(`/shop/${shop.slug}/settings/team?notice=not-authorized`);
    expect(await contactOf(db, captain)).toEqual(before);
  });

  it("lets an owner set one, and names the card the outcome belongs to", async () => {
    const { db, shop, captain, owner } = await context();
    signIn(shop, owner);

    const to = await redirectedTo(() =>
      saveStaffEmergencyContactAction(contactForm(captain, "Marta Okonkwo", "+1-305-555-0114")),
    );

    // `contactFor` is what puts the outcome in that card's own action row
    // instead of a banner above a roster of eleven people.
    expect(to).toBe(
      `/shop/${shop.slug}/settings/team?notice=contact-saved&contactFor=${captain}#staff-${captain}`,
    );
    expect(await contactOf(db, captain)).toMatchObject({
      name: "Marta Okonkwo",
      phone: "+1-305-555-0114",
    });
  });

  it("reports a half-filled contact on the card, and writes nothing", async () => {
    const { db, shop, captain, owner } = await context();
    signIn(shop, owner);
    const before = await contactOf(db, captain);

    const to = await redirectedTo(() =>
      saveStaffEmergencyContactAction(contactForm(captain, "Marta Okonkwo", "")),
    );

    expect(to).toBe(
      `/shop/${shop.slug}/settings/team?notice=half-filled&contactFor=${captain}#staff-${captain}`,
    );
    // Nothing written, not even the half that was supplied — a refused save
    // must not leave the row holding a name whose number it just dropped.
    expect(await contactOf(db, captain)).toEqual(before);
  });
});
