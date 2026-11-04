// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { noticeUrl } from "@/lib/staff-notices";
import { redirectedTo, staffSession } from "@/test/staff-session";

/**
 * **Wait-listing from a date request's band keeps the request in view** (issue
 * #3741). The landing carries `?add=1&request=` only for a real uuid; a junk id
 * is dropped. The request is a place to land, never linked to the entry.
 */

vi.mock("next/navigation", () => ({
  redirect: vi.fn((to: string) => {
    throw new Error(`REDIRECT:${to}`);
  }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/db/client", () => ({ getDb: vi.fn(async () => ({})) }));
vi.mock("@/lib/session", () => ({ requireShopSurface: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ trackEvent: vi.fn() }));
vi.mock("@/db/interests", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db/interests")>();
  return {
    ...actual,
    askForDeparture: vi.fn(),
    askForDepartureAsKnownDiver: vi.fn(),
  };
});

const { askForDeparture, askForDepartureAsKnownDiver } = await import("@/db/interests");
const { requireShopSurface } = await import("@/lib/session");
const { addKnownDiverToWaitlistAction, addToWaitlistAction } = await import(
  "./roster-seating-actions"
);

const SHOP_SLUG = "reef-life";
const TRIP_ID = "33333333-3333-4333-8333-333333333333";
const PERSON_ID = "44444444-4444-4444-8444-444444444444";
const REQUEST_ID = "55555555-5555-4555-8555-555555555555";
const TRIP = `/shop/${SHOP_SLUG}/trips/${TRIP_ID}`;

beforeEach(() => {
  vi.mocked(requireShopSurface).mockResolvedValue({
    session: staffSession({
      shopId: "11111111-1111-4111-8111-111111111111",
      shopSlug: SHOP_SLUG,
      personId: "22222222-2222-4222-8222-222222222222",
    }),
  } as never);
  vi.mocked(askForDeparture).mockResolvedValue({ ok: true } as never);
  vi.mocked(askForDepartureAsKnownDiver).mockResolvedValue({ ok: true } as never);
});

function typedEntry(request?: string) {
  const data = new FormData();
  data.set("fullName", "Ada Lindqvist");
  data.set("email", "ada@example.invalid");
  if (request !== undefined) data.set("request", request);
  return data;
}

function pickedEntry(request?: string) {
  const data = new FormData();
  data.set("personId", PERSON_ID);
  if (request !== undefined) data.set("request", request);
  return data;
}

describe("wait-listing from a date request's band", () => {
  it("lands a typed entry back on the request's band", async () => {
    const to = await redirectedTo(() =>
      addToWaitlistAction(SHOP_SLUG, TRIP_ID, typedEntry(REQUEST_ID)),
    );
    expect(to).toBe(noticeUrl(`${TRIP}?add=1&request=${REQUEST_ID}`, "diver-waitlisted"));
  });

  it("lands a picked diver back on the request's band", async () => {
    const to = await redirectedTo(() =>
      addKnownDiverToWaitlistAction(SHOP_SLUG, TRIP_ID, pickedEntry(REQUEST_ID)),
    );
    expect(to).toBe(noticeUrl(`${TRIP}?add=1&request=${REQUEST_ID}`, "diver-waitlisted"));
  });

  it.each(["not-a-uuid", "", `${REQUEST_ID}&evil=1`])(
    "drops a request id of %j and lands on the bare departure",
    async (junk) => {
      expect(
        await redirectedTo(() => addToWaitlistAction(SHOP_SLUG, TRIP_ID, typedEntry(junk))),
      ).toBe(noticeUrl(TRIP, "diver-waitlisted"));
      expect(
        await redirectedTo(() =>
          addKnownDiverToWaitlistAction(SHOP_SLUG, TRIP_ID, pickedEntry(junk)),
        ),
      ).toBe(noticeUrl(TRIP, "diver-waitlisted"));
    },
  );

  it("lands without a request exactly as before, and never hands the request to the wait list", async () => {
    expect(await redirectedTo(() => addToWaitlistAction(SHOP_SLUG, TRIP_ID, typedEntry()))).toBe(
      noticeUrl(TRIP, "diver-waitlisted"),
    );
    await redirectedTo(() => addToWaitlistAction(SHOP_SLUG, TRIP_ID, typedEntry(REQUEST_ID)));
    expect(JSON.stringify(vi.mocked(askForDeparture).mock.calls.at(-1))).not.toContain(REQUEST_ID);
  });
});
