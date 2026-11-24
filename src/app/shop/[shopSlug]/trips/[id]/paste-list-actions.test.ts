import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * **Paste a list** ("Try it Saturday", item 1), the action: staff only and
 * shop scoped, a preview that writes nothing, and a confirm that reads the
 * text again rather than trusting the browser's copy of the preview.
 */

vi.mock("@/db/client", () => ({ getDb: vi.fn(async () => ({ db: "handle" })) }));
vi.mock("@/features/accounts/session", () => ({ requireShopSurface: vi.fn() }));
vi.mock("@/features/bookings/paste-list/store", () => ({
  PASTE_NEW_PERSON: "new",
  matchPastedPeople: vi.fn(),
  seatPastedList: vi.fn(),
}));

const { requireShopSurface } = await import("@/features/accounts/session");
const { matchPastedPeople, seatPastedList } = await import("@/features/bookings/paste-list/store");
const { pasteListAction } = await import("./paste-list-actions");

const SHOP_ID = "22222222-2222-4222-8222-222222222222";
const TRIP_ID = "33333333-3333-4333-8333-333333333333";
const ON_FILE = "44444444-4444-4444-8444-444444444444";
const LIST = "Name\tEmail\nAna López\tana@example.com\nBen Ortiz\t\n";

function form(fields: Record<string, string>, choices: string[] = []): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  for (const choice of choices) data.append("choice", choice);
  return data;
}

beforeEach(() => {
  vi.mocked(requireShopSurface).mockResolvedValue({
    session: { user: { shopId: SHOP_ID, personId: "staff" } },
  } as never);
  vi.mocked(matchPastedPeople).mockResolvedValue([
    { candidates: [], choice: "new" },
    { candidates: [], choice: "new" },
  ]);
  vi.mocked(seatPastedList).mockResolvedValue([]);
});

afterEach(() => vi.clearAllMocks());

describe("pasteListAction", () => {
  it("asks the shop gate with the slug before reading anything", async () => {
    vi.mocked(requireShopSurface).mockRejectedValue(new Error("NOT_FOUND"));
    await expect(
      pasteListAction("other-shop", TRIP_ID, undefined, form({ list: LIST })),
    ).rejects.toThrow("NOT_FOUND");
    expect(requireShopSurface).toHaveBeenCalledWith("other-shop");
    expect(matchPastedPeople).not.toHaveBeenCalled();
  });

  it("previews what was read, matched in the session's shop, and seats nobody", async () => {
    const state = await pasteListAction("blue-mantis", TRIP_ID, undefined, form({ list: LIST }));
    expect(state).toMatchObject({
      step: "preview",
      text: LIST,
      rows: [
        { fullName: "Ana López", email: "ana@example.com", choice: "new" },
        { fullName: "Ben Ortiz", choice: "new" },
      ],
    });
    expect(vi.mocked(matchPastedPeople).mock.calls[0]?.[1]).toBe(SHOP_ID);
    expect(seatPastedList).not.toHaveBeenCalled();
  });

  it("says why a list could not be read", async () => {
    expect(await pasteListAction("blue-mantis", TRIP_ID, undefined, form({ list: "" }))).toEqual({
      step: "refused",
      reason: "empty",
    });
    expect(
      await pasteListAction("blue-mantis", "not-a-trip", undefined, form({ list: LIST })),
    ).toEqual({ step: "refused", reason: "invalid" });
  });

  it("seats from the text read again, with each person's choice, in the session's shop", async () => {
    await pasteListAction(
      "blue-mantis",
      TRIP_ID,
      undefined,
      form({ step: "seat", list: LIST }, [ON_FILE, "new"]),
    );
    expect(vi.mocked(seatPastedList).mock.calls[0]?.[1]).toEqual({
      shopId: SHOP_ID,
      tripId: TRIP_ID,
      actorPersonId: "staff",
      rows: [
        {
          row: 2,
          fullName: "Ana López",
          email: "ana@example.com",
          phone: undefined,
          choice: ON_FILE,
        },
        { row: 3, fullName: "Ben Ortiz", email: undefined, phone: undefined, choice: "new" },
      ],
    });
  });

  it("refuses a confirm with a choice missing or not a record id, and seats nobody", async () => {
    const missing = await pasteListAction(
      "blue-mantis",
      TRIP_ID,
      undefined,
      form({ step: "seat", list: LIST }, ["new"]),
    );
    const junk = await pasteListAction(
      "blue-mantis",
      TRIP_ID,
      undefined,
      form({ step: "seat", list: LIST }, ["'; drop table people", "new"]),
    );
    expect(missing).toEqual({ step: "refused", reason: "invalid" });
    expect(junk).toEqual({ step: "refused", reason: "invalid" });
    expect(seatPastedList).not.toHaveBeenCalled();
  });
});
