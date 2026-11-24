// i18n-exempt-file: test fixture names are seeded data.
import { describe, expect, it } from "vitest";
import { BULK_OFFER_LIMIT, bulkOfferCandidates } from "./bulk-offer";
import type { WhoWantsInGroup } from "./FillSeatsCard";
import type { WhoWantsInRow } from "./who-wants-in-rows";

const row = (id: string, over: Partial<WhoWantsInRow> = {}): WhoWantsInRow => ({
  interestId: id,
  name: `Diver ${id}`,
  email: `${id}@example.com`,
  facts: "",
  certification: null,
  belowBar: false,
  offeredAt: null,
  ...over,
});

const groups = (...rows: WhoWantsInRow[][]): WhoWantsInGroup[] =>
  rows.map((list, at) => ({
    id: ["departure", "date", "anytime"][at] ?? "x",
    heading: "",
    rows: list,
  }));

const ask = { openSeats: 7, canOffer: true, soldElsewhere: false };
const ids = (rows: WhoWantsInRow[]) => rows.map((each) => each.interestId);

describe("bulkOfferCandidates", () => {
  it("takes the first few in the card's own order: this departure, then the date, then the list", () => {
    const picked = bulkOfferCandidates({
      ...ask,
      groups: groups([row("a"), row("b")], [row("c")], [row("d"), row("e")]),
    });
    expect(ids(picked)).toEqual(["a", "b", "c"]);
    expect(picked).toHaveLength(BULK_OFFER_LIMIT);
  });

  it("reads past the preview cap, in order, when the shown rows run out", () => {
    const picked = bulkOfferCandidates({
      ...ask,
      groups: [{ id: "anytime", heading: "", rows: [row("a")], more: [row("b"), row("c")] }],
    });
    expect(ids(picked)).toEqual(["a", "b", "c"]);
  });

  it("never offers more people than there are open seats", () => {
    const picked = bulkOfferCandidates({
      ...ask,
      openSeats: 2,
      groups: groups([row("a"), row("b"), row("c")]),
    });
    expect(ids(picked)).toEqual(["a", "b"]);
  });

  it("has nobody to offer with an empty wait list, or a full boat", () => {
    expect(bulkOfferCandidates({ ...ask, groups: groups([]) })).toEqual([]);
    expect(bulkOfferCandidates({ ...ask, openSeats: 0, groups: groups([row("a")]) })).toEqual([]);
  });

  it("skips a candidate already offered this seat, and takes the next in line", () => {
    const picked = bulkOfferCandidates({
      ...ask,
      groups: groups([row("a", { offeredAt: new Date("2026-11-20T10:00:00Z") }), row("b")]),
    });
    expect(ids(picked)).toEqual(["b"]);
  });

  it("has nobody to offer once everyone waiting was offered", () => {
    const offeredAt = new Date("2026-11-20T10:00:00Z");
    expect(
      bulkOfferCandidates({
        ...ask,
        groups: groups([row("a", { offeredAt }), row("b", { offeredAt })]),
      }),
    ).toEqual([]);
  });

  it("leaves a diver below the bar and one with no address to their own row's offer", () => {
    const picked = bulkOfferCandidates({
      ...ask,
      groups: groups([row("a", { belowBar: true }), row("b", { email: null }), row("c")]),
    });
    expect(ids(picked)).toEqual(["c"]);
  });

  it("names one interest once, whichever groups list it", () => {
    const picked = bulkOfferCandidates({
      ...ask,
      groups: groups([row("a")], [row("a"), row("b")]),
    });
    expect(ids(picked)).toEqual(["a", "b"]);
  });

  it("offers nobody on a trip sold elsewhere: its seats are not DiveDay's to sell", () => {
    expect(
      bulkOfferCandidates({ ...ask, soldElsewhere: true, groups: groups([row("a"), row("b")]) }),
    ).toEqual([]);
  });

  it("offers nobody for a role that may not act on the wait list", () => {
    expect(bulkOfferCandidates({ ...ask, canOffer: false, groups: groups([row("a")]) })).toEqual(
      [],
    );
  });
});
