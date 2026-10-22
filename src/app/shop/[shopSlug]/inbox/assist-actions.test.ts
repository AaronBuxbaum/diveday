import { describe, expect, it, vi } from "vitest";
import { readFormDraft } from "@/db/form-drafts";
import { formDrafts } from "@/db/schema";
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
  notFound: vi.fn(() => {
    throw new Error("NOT_FOUND");
  }),
}));
vi.mock("@/db/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db/client")>();
  return { ...actual, getDb: vi.fn() };
});
vi.mock("@/lib/session", () => ({ requireStaffSession: vi.fn() }));
// The reading itself is `src/db/booking-ask-assists.test.ts`; this is the hand-off.
vi.mock("@/db/booking-ask-assists", () => ({ bookingAskFromMessage: vi.fn() }));
const { getDb } = await import("@/db/client");
const { requireStaffSession } = await import("@/lib/session");
const { bookingAskFromMessage } = await import("@/db/booking-ask-assists");
const { requestFromMessageAction } = await import("./assist-actions");

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

function form(messageId: string): FormData {
  const formData = new FormData();
  formData.set("messageId", messageId);
  return formData;
}

describe("Make a request", () => {
  it("keeps the reading as the staffer's Took-a-call draft and opens the form on it", async () => {
    const { db, shop, owner } = await signedIn();
    vi.mocked(bookingAskFromMessage).mockResolvedValue({
      fields: {
        outcome: "date-request",
        email: "group.lead@example.org",
        preferredDate: "2026-10-24",
        divers: "4",
      },
      callback: null,
      match: null,
    });
    const to = await redirectedTo(() => requestFromMessageAction(form(MESSAGE_ID)));
    expect(to).toBe(`/shop/${shop.slug}/bookings/new?outcome=date-request#call`);
    // Read inside the session's shop, whatever the form posted.
    expect(bookingAskFromMessage).toHaveBeenCalledWith(db, {
      shopId: shop.id,
      messageId: MESSAGE_ID,
    });
    const draft = await readFormDraft(db, shop.id, owner, "took_a_call");
    expect(draft?.fields).toMatchObject({ email: "group.lead@example.org", divers: "4" });
  });

  it("says so, and keeps no draft, when nothing in the message reads as a booking", async () => {
    const { db, shop, owner } = await signedIn();
    vi.mocked(bookingAskFromMessage).mockResolvedValue({
      fields: { outcome: "date-request" },
      callback: null,
      match: null,
    });
    await db.delete(formDrafts);
    const to = await redirectedTo(() => requestFromMessageAction(form(MESSAGE_ID)));
    expect(to).toBe(`/shop/${shop.slug}/inbox?notice=request-nothing`);
    expect(await readFormDraft(db, shop.id, owner, "took_a_call")).toBeNull();
  });

  it("reads nothing for an id that is not one", async () => {
    await signedIn();
    vi.mocked(bookingAskFromMessage).mockClear();
    await redirectedTo(() => requestFromMessageAction(form("not-a-uuid")));
    expect(bookingAskFromMessage).not.toHaveBeenCalled();
  });
});
