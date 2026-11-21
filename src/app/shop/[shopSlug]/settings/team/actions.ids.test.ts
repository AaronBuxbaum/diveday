import { describe, expect, it, vi } from "vitest";
import { fileScopedShopContext } from "@/test/db";
import {
  redirectedTo,
  SEEDED_OWNER_EMAIL,
  seededStaffPersonId,
  staffSession,
} from "@/test/staff-session";

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
vi.mock("../../../../../features/accounts/session", () => ({ requireStaffSession: vi.fn() }));

const { getDb } = await import("@/db/client");
const { requireStaffSession } = await import("../../../../../features/accounts/session");
const actions = await import("./actions");

const NOT_A_UUID = "not-a-uuid";

/** A malformed id is the same answer as an id that is not on the roster, never a database error. */
describe("team forms with a malformed id", () => {
  const cases: Array<[string, keyof typeof actions, Record<string, string>]> = [
    ["resendInviteAction", "resendInviteAction", { userAccountId: NOT_A_UUID }],
    ["saveStaffRolesAction", "saveStaffRolesAction", { personId: NOT_A_UUID, role_crew: "on" }],
    [
      "saveStaffEmergencyContactAction",
      "saveStaffEmergencyContactAction",
      { personId: NOT_A_UUID },
    ],
    ["saveStaffLanguagesAction", "saveStaffLanguagesAction", { personId: NOT_A_UUID }],
    [
      "setStaffStatusAction (person)",
      "setStaffStatusAction",
      { personId: NOT_A_UUID, userAccountId: "00000000-0000-4000-8000-000000000000" },
    ],
    [
      "setStaffStatusAction (account)",
      "setStaffStatusAction",
      { personId: "00000000-0000-4000-8000-000000000000", userAccountId: NOT_A_UUID },
    ],
    ["removeStaffAction", "removeStaffAction", { personId: NOT_A_UUID, userAccountId: NOT_A_UUID }],
    [
      "cancelInviteAction",
      "cancelInviteAction",
      { personId: NOT_A_UUID, userAccountId: NOT_A_UUID },
    ],
    [
      "restoreStaffAction",
      "restoreStaffAction",
      { personId: NOT_A_UUID, userAccountId: NOT_A_UUID, roles: "crew" },
    ],
    [
      "reviewStaffCredentialAction",
      "reviewStaffCredentialAction",
      { credentialId: NOT_A_UUID, status: "verified", revision: "1" },
    ],
    [
      "deleteStaffCredentialAction",
      "deleteStaffCredentialAction",
      { credentialId: NOT_A_UUID, revision: "1" },
    ],
  ];

  it.each(cases)("%s refuses without reaching the database", async (_name, key, fields) => {
    const { db, shop } = ctx;
    vi.mocked(getDb).mockResolvedValue(db);
    const owner = await seededStaffPersonId(db, shop.id, SEEDED_OWNER_EMAIL);
    vi.mocked(requireStaffSession).mockResolvedValue(
      staffSession({ shopId: shop.id, shopSlug: shop.slug, personId: owner }),
    );
    const form = new FormData();
    for (const [name, value] of Object.entries(fields)) form.set(name, value);
    const action = actions[key] as (formData: FormData) => Promise<unknown>;

    const to = await redirectedTo(() => action(form));

    const expected = key.includes("Credential") ? "credential-invalid" : "not-found";
    expect(to).toBe(`/shop/${shop.slug}/settings/team?notice=${expected}`);
  });
});
