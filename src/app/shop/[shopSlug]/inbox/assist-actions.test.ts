import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { personRoles } from "@/db/schema";
import { fileScopedShopContext } from "@/test/db";
import { SEEDED_OWNER_EMAIL, seededStaffPersonId, staffSession } from "@/test/staff-session";
import { readFormDraft } from "../../../../features/form-drafts/store";

const ctx = fileScopedShopContext();

vi.mock("next/navigation", () => ({
  redirect: vi.fn((to: string) => {
    throw new Error(`REDIRECT:${to}`);
  }),
  notFound: vi.fn(() => {
    throw new Error("NOT_FOUND");
  }),
}));
vi.mock("@/db/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db/client")>();
  return { ...actual, getDb: vi.fn() };
});
vi.mock("../../../../features/session/rules", () => ({ requireStaffSession: vi.fn() }));
vi.mock("@/features/inbox-assists", () => ({ draftReplyToMessage: vi.fn() }));
const { draftReplyToMessage } = await import("@/features/inbox-assists");
const { getDb } = await import("@/db/client");
const { requireStaffSession } = await import("../../../../features/session/rules");
const { draftInboxResponseAction } = await import("./assist-actions");

const MESSAGE_ID = "8f000000-1111-4222-8333-444444444444";

async function signedIn() {
  const { db, shop } = ctx;
  vi.mocked(getDb).mockResolvedValue(db);
  const owner = await seededStaffPersonId(db, shop.id, SEEDED_OWNER_EMAIL);
  vi.mocked(requireStaffSession).mockResolvedValue(
    staffSession({ shopId: shop.id, shopSlug: shop.slug, personId: owner }),
  );
  return { db, shop, owner };
}

describe("Draft response", () => {
  it("passes the session shop and selected message without saving a request", async () => {
    const { db, shop, owner } = await signedIn();
    vi.mocked(draftReplyToMessage).mockResolvedValue("Please park behind the shop.");
    expect(await draftInboxResponseAction(MESSAGE_ID)).toBe("Please park behind the shop.");
    expect(draftReplyToMessage).toHaveBeenCalledWith(db, {
      shopId: shop.id,
      messageId: MESSAGE_ID,
    });
    expect(await readFormDraft(db, shop.id, owner, "took_a_call")).toBeNull();
  });
  it("refuses a revoked staff role before reading a message", async () => {
    const { db, owner } = await signedIn();
    await db.delete(personRoles).where(eq(personRoles.personId, owner));
    vi.mocked(draftReplyToMessage).mockClear();
    expect(await draftInboxResponseAction(MESSAGE_ID)).toBeNull();
    expect(draftReplyToMessage).not.toHaveBeenCalled();
  });
  it("refuses malformed message identifiers before reading a message", async () => {
    vi.mocked(draftReplyToMessage).mockClear();
    expect(await draftInboxResponseAction("not-an-id")).toBeNull();
    expect(draftReplyToMessage).not.toHaveBeenCalled();
  });
});
