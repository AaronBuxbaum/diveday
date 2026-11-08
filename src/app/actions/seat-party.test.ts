import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PARTY_MAX, partyMemberField } from "@/lib/seat-party-form";

/**
 * **A family seated in one pass** (fifth loop, item 9; review fixes): the
 * on-file check names the rows that matched, a per-row choice settles each
 * one, an overlong party is refused rather than trimmed, and a seated party
 * leaves no draft of the lead's details behind.
 */

vi.mock("@/db/client", () => ({ getDb: vi.fn(async () => ({ db: "handle" })) }));
vi.mock("../../features/divers/store", () => ({ findSimilarDivers: vi.fn(async () => []) }));
vi.mock("../../features/seat-diver/store", () => ({ seatDiver: vi.fn(), seatParty: vi.fn() }));
vi.mock("../../features/form-drafts/store", () => ({ discardFormDraft: vi.fn(async () => {}) }));
vi.mock("../../features/navigation/rules", () => ({
  revalidateAndRedirect: vi.fn((_path: string, to: string) => {
    throw new Error(`REDIRECT:${to}`);
  }),
}));
vi.mock("../../features/session/rules", () => ({ requireShopSurface: vi.fn() }));

const { findSimilarDivers } = await import("../../features/divers/store");
const { seatParty } = await import("../../features/seat-diver/store");
const { discardFormDraft } = await import("../../features/form-drafts/store");
const { requireShopSurface } = await import("../../features/session/rules");
const { seatPartyAction } = await import("./seat-diver");

const SHOP_ID = "22222222-2222-4222-8222-222222222222";
const TRIP_ID = "33333333-3333-4333-8333-333333333333";
const LEAD_BOOKING = "55555555-5555-4555-8555-555555555555";
const LEO_ON_FILE = "44444444-4444-4444-8444-444444444444";

function form(extra: [string, string][] = []): FormData {
  const data = new FormData();
  data.set("tripId", TRIP_ID);
  data.set("fullName", "Ana Lopez");
  data.set("participantType", "diver");
  data.set(partyMemberField(1, "name"), "Mia Lopez");
  data.set(partyMemberField(1, "minor"), "true");
  data.set(partyMemberField(1, "type"), "snorkeler");
  data.set(partyMemberField(2, "name"), "Leo Lopez");
  for (const [name, value] of extra) data.set(name, value);
  return data;
}

async function landing(data: FormData): Promise<string> {
  try {
    await seatPartyAction("blue-mantis", data);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.startsWith("REDIRECT:")) return message.slice("REDIRECT:".length);
    throw error;
  }
  throw new Error("the action neither redirected nor threw");
}

beforeEach(() => {
  vi.mocked(requireShopSurface).mockResolvedValue({
    session: { user: { shopId: SHOP_ID, personId: "staff" } },
  } as never);
  vi.mocked(seatParty).mockResolvedValue({
    ok: true,
    seats: [{ bookingId: LEAD_BOOKING }],
  } as never);
  vi.mocked(findSimilarDivers).mockResolvedValue([]);
});

afterEach(() => vi.clearAllMocks());

describe("seatPartyAction", () => {
  it("names the rows that read like somebody on file, and seats nobody", async () => {
    vi.mocked(findSimilarDivers).mockImplementation(async (_db, _shop, name) =>
      name === "Leo Lopez" ? ([{ id: LEO_ON_FILE }] as never) : [],
    );
    const to = new URL(await landing(form()), "http://x");
    expect(to.searchParams.get("notice")).toBe("party-on-file");
    expect(to.searchParams.get("onFile-2")).toBe("Leo Lopez");
    expect(to.searchParams.has("onFile-1")).toBe(false);
    expect(seatParty).not.toHaveBeenCalled();
  });

  it("seats each row as the staffer chose: the record on file, or a new person", async () => {
    vi.mocked(findSimilarDivers).mockResolvedValue([{ id: LEO_ON_FILE }] as never);
    await landing(
      form([
        [partyMemberField(0, "match"), "new"],
        [partyMemberField(1, "match"), "new"],
        [partyMemberField(2, "match"), LEO_ON_FILE],
      ]),
    );
    expect(vi.mocked(seatParty).mock.calls[0]?.[1].members).toEqual([
      expect.objectContaining({ fullName: "Ana Lopez", minor: false, participantType: "diver" }),
      expect.objectContaining({ fullName: "Mia Lopez", minor: true, participantType: "snorkeler" }),
      expect.objectContaining({ personId: LEO_ON_FILE, typedName: "Leo Lopez", minor: false }),
    ]);
  });

  it("refuses a chosen record that is not one of that row's candidates", async () => {
    vi.mocked(findSimilarDivers).mockResolvedValue([{ id: LEO_ON_FILE }] as never);
    const stranger = "55555555-5555-4555-8555-555555555555";
    const to = new URL(
      await landing(
        form([
          [partyMemberField(0, "match"), "new"],
          [partyMemberField(1, "match"), "new"],
          [partyMemberField(2, "match"), stranger],
        ]),
      ),
      "http://x",
    );
    expect(to.searchParams.get("notice")).toBe("diver-invalid");
    expect(seatParty).not.toHaveBeenCalled();
  });

  it("still asks about a row the staffer has not settled", async () => {
    vi.mocked(findSimilarDivers).mockResolvedValue([{ id: LEO_ON_FILE }] as never);
    const to = new URL(
      await landing(form([[partyMemberField(2, "match"), LEO_ON_FILE]])),
      "http://x",
    );
    expect(to.searchParams.get("onFile-0")).toBe("Ana Lopez");
    expect(to.searchParams.get("onFile-1")).toBe("Mia Lopez");
    expect(to.searchParams.has("onFile-2")).toBe(false);
  });

  it("refuses a party over the limit instead of seating it with somebody left off", async () => {
    const extra: [string, string][] = Array.from({ length: PARTY_MAX }, (_, index) => [
      partyMemberField(index + 3, "name"),
      `Extra ${index}`,
    ]);
    const to = new URL(await landing(form(extra)), "http://x");
    expect(to.searchParams.get("notice")).toBe("diver-invalid");
    expect(seatParty).not.toHaveBeenCalled();
  });

  it("gives the first person their own tick, and a date of birth beside it", async () => {
    await landing(
      form([
        [partyMemberField(0, "minor"), "true"],
        [partyMemberField(0, "dob"), "2010-05-06"],
      ]),
    );
    expect(vi.mocked(seatParty).mock.calls[0]?.[1].members[0]).toMatchObject({
      fullName: "Ana Lopez",
      minor: true,
      dateOfBirth: "2010-05-06",
    });
  });

  it("drops the draft of the lead's details once the party is seated", async () => {
    const to = new URL(await landing(form()), "http://x");
    expect(to.pathname).toBe(`/shop/blue-mantis/trips/${TRIP_ID}/party/${LEAD_BOOKING}/waivers`);
    expect(discardFormDraft).toHaveBeenCalledWith(expect.anything(), SHOP_ID, "staff", "new_diver");
  });

  it("keeps the form when the boat takes nobody", async () => {
    vi.mocked(seatParty).mockResolvedValue({ ok: false, reason: "trip_unavailable" } as never);
    const to = new URL(await landing(form()), "http://x");
    expect(to.searchParams.get("notice")).toBe("diver-unavailable");
    expect(to.searchParams.get("surface")).toBe("departure");
    expect(discardFormDraft).not.toHaveBeenCalled();
  });

  it("records the party as ordinary roster seats", async () => {
    await landing(form());
    expect(vi.mocked(seatParty).mock.calls[0]?.[1]).toMatchObject({
      entry: "roster",
      refusals: "specific",
    });
  });
});
