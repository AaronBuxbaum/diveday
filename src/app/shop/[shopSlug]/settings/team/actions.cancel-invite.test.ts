import { describe, expect, it, vi } from "vitest";
import { fileScopedShopContext } from "@/test/db";
import {
  redirectedTo,
  SEEDED_CAPTAIN_EMAIL,
  SEEDED_OWNER_EMAIL,
  seededStaffPersonId,
  staffSession,
} from "@/test/staff-session";
import { inviteStaffMember, listShopStaff } from "../../../../../features/staff-accounts/store";

// Withdrawing a pending invite, issue #4013.
const ctx = fileScopedShopContext();

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
vi.mock("../../../../../features/session/rules", () => ({ requireStaffSession: vi.fn() }));

const { getDb } = await import("@/db/client");
const { requireStaffSession } = await import("../../../../../features/session/rules");
const { cancelInviteAction } = await import("./actions");

async function pendingInvite(signInAs: "owner" | "captain") {
  const { db, shop } = ctx;
  vi.mocked(getDb).mockResolvedValue(db);
  const invited = await inviteStaffMember(db, {
    shopId: shop.id,
    fullName: "Pat Pending",
    email: "pat.pending@example.com",
    roles: ["crew"],
  });
  if (!invited.ok) throw new Error("invite refused");
  const personId = await seededStaffPersonId(
    db,
    shop.id,
    signInAs === "owner" ? SEEDED_OWNER_EMAIL : SEEDED_CAPTAIN_EMAIL,
  );
  vi.mocked(requireStaffSession).mockResolvedValue(
    staffSession({ shopId: shop.id, shopSlug: shop.slug, personId }),
  );
  const form = new FormData();
  form.set("personId", invited.personId);
  form.set("userAccountId", invited.userAccountId);
  form.set("fullName", "Pat Pending");
  return { db, shop, invited, form };
}

describe("cancelInviteAction", () => {
  it("lets an owner withdraw the invite and hands the toast its Undo", async () => {
    const { db, shop, invited, form } = await pendingInvite("owner");

    const to = await redirectedTo(() => cancelInviteAction(form));

    const url = new URL(to, "https://example.test");
    expect(url.pathname).toBe(`/shop/${shop.slug}/settings/team`);
    expect(url.searchParams.get("notice")).toBe("invite-canceled");
    expect(url.searchParams.get("undoPersonId")).toBe(invited.personId);
    expect(url.searchParams.get("undoRoles")).toBe("crew");
    expect(url.searchParams.get("undoName")).toBe("Pat Pending");
    const team = await listShopStaff(db, shop.id);
    expect(team.some((member) => member.personId === invited.personId)).toBe(false);
  });

  it("refuses a captain, leaving the invite in place", async () => {
    const { db, shop, invited, form } = await pendingInvite("captain");

    const to = await redirectedTo(() => cancelInviteAction(form));

    expect(to).toBe(`/shop/${shop.slug}/settings/team?notice=not-authorized`);
    const team = await listShopStaff(db, shop.id);
    expect(team.some((member) => member.personId === invited.personId)).toBe(true);
  });
});
