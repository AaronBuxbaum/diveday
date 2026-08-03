import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppDb } from "@/db/client";
import { personRoles, userAccounts } from "@/db/schema";
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
 * next request. So a captain reaching `saveAllStaffRolesAction` with a hand-made
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
const { removeStaffAction, saveAllStaffRolesAction, setStaffStatusAction } = await import(
  "./actions"
);

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
 * The whole-page "Save changes" form: every staff member's current roles ticked,
 * with `overrides` replacing one person's. Sending only the edited person would
 * trip the action's own "someone has no roles" guard and never reach the write.
 */
async function rolesForm(
  db: AppDb,
  shopId: string,
  overrides: Record<string, Role[]> = {},
): Promise<FormData> {
  const staff = await listShopStaff(db, shopId);
  const formData = new FormData();
  for (const member of staff) {
    for (const role of overrides[member.personId] ?? member.roles) {
      formData.set(`role_${member.personId}_${role}`, "on");
    }
  }
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
    const formData = await rolesForm(db, shop.id, { [captain]: ["owner", "manager"] });

    const to = await redirectedTo(() => saveAllStaffRolesAction(formData));

    expect(to).toBe(`/shop/${shop.slug}/settings/team?notice=not_authorized`);
    expect(await rolesOf(db, captain)).toEqual(["captain"]);
  });

  it("refuses a captain who posts the owner *out* of her own roles", async () => {
    const { db, shop, captain, owner } = await context();
    signIn(shop, captain);
    const formData = await rolesForm(db, shop.id, { [owner]: ["crew"] });

    const to = await redirectedTo(() => saveAllStaffRolesAction(formData));

    expect(to).toBe(`/shop/${shop.slug}/settings/team?notice=not_authorized`);
    expect(await rolesOf(db, owner)).toEqual(["manager", "owner"]);
  });

  it("lets an owner change a role", async () => {
    const { db, shop, captain, owner } = await context();
    signIn(shop, owner);
    const formData = await rolesForm(db, shop.id, { [captain]: ["captain", "divemaster"] });

    const to = await redirectedTo(() => saveAllStaffRolesAction(formData));

    expect(to).toBe(`/shop/${shop.slug}/settings/team?notice=changes_saved`);
    expect(await rolesOf(db, captain)).toEqual(["captain", "divemaster"]);
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

    expect(to).toBe(`/shop/${shop.slug}/settings/team?notice=not_authorized`);
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

    expect(to).toBe(`/shop/${shop.slug}/settings/team?notice=not_authorized`);
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
