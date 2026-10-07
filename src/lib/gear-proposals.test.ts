import { describe, expect, it } from "vitest";
import { type ProposalUnit, proposalKey, proposeRentalUnits } from "./gear-proposals";

const ok = { state: "ok" };
const unit = (
  id: string,
  size: string | null,
  serviceState: { state: string } = ok,
): ProposalUnit & { id: string } => ({ id, label: id, size, serviceState });

const proposed = (map: Map<string, ProposalUnit>, bookingId: string, kind: string) =>
  map.get(proposalKey(bookingId, kind))?.id ?? null;

describe("proposeRentalUnits", () => {
  it("proposes an exact-size unit for a sized piece, and nothing for another size", () => {
    const free = new Map([["bcd", [unit("BCD #1", "M"), unit("BCD #2", "L")]]]);
    const map = proposeRentalUnits(
      [
        { bookingId: "a", wanted: [{ kind: "bcd", size: "l" }] },
        { bookingId: "b", wanted: [{ kind: "bcd", size: "XL" }] },
      ],
      free,
    );
    expect(proposed(map, "a", "bcd")).toBe("BCD #2");
    // An XL diver is not offered an L: a near size is a person's call.
    expect(proposed(map, "b", "bcd")).toBeNull();
  });

  it("proposes nothing for a sized piece with no size on file", () => {
    const free = new Map([["wetsuit", [unit("WS #1", "M")]]]);
    const map = proposeRentalUnits(
      [{ bookingId: "a", wanted: [{ kind: "wetsuit", size: null }] }],
      free,
    );
    expect(map.size).toBe(0);
  });

  it("never matches a drysuit diver's fins or gloves on the bare number", () => {
    const free = new Map([
      ["fins", [unit("Fins #1", "9")]],
      ["gloves", [unit("Gloves #1", null)]],
    ]);
    const map = proposeRentalUnits(
      [
        {
          bookingId: "a",
          wanted: [
            { kind: "fins", size: "9", sizeIsAStart: true },
            { kind: "gloves", size: null, sizeIsAStart: true },
          ],
        },
      ],
      free,
    );
    expect(map.size).toBe(0);
  });

  it("proposes any free unit of a sizeless kind", () => {
    const free = new Map([["mask", [unit("Mask #2", null), unit("Mask #1", null)]]]);
    const map = proposeRentalUnits(
      [{ bookingId: "a", wanted: [{ kind: "mask", size: null }] }],
      free,
    );
    expect(proposed(map, "a", "mask")).toBe("Mask #1");
  });

  it("never proposes one unit twice, and leaves the divers it runs out for open", () => {
    const free = new Map([["bcd", [unit("BCD #1", "L"), unit("BCD #2", "L")]]]);
    const rows = ["a", "b", "c"].map((bookingId) => ({
      bookingId,
      wanted: [{ kind: "bcd", size: "L" }],
    }));
    const map = proposeRentalUnits(rows, free);
    expect(proposed(map, "a", "bcd")).toBe("BCD #1");
    expect(proposed(map, "b", "bcd")).toBe("BCD #2");
    expect(proposed(map, "c", "bcd")).toBeNull();
  });

  it("never proposes a unit whose service has lapsed, and takes due-soon ones last", () => {
    const free = new Map([
      [
        "regulator",
        [
          unit("Reg #1", null, { state: "overdue" }),
          unit("Reg #2", null, { state: "due_soon" }),
          unit("Reg #3", null),
        ],
      ],
    ]);
    const rows = ["a", "b", "c"].map((bookingId) => ({
      bookingId,
      wanted: [{ kind: "regulator", size: null }],
    }));
    const map = proposeRentalUnits(rows, free);
    expect(proposed(map, "a", "regulator")).toBe("Reg #3");
    expect(proposed(map, "b", "regulator")).toBe("Reg #2");
    expect(proposed(map, "c", "regulator")).toBeNull();
  });

  /**
   * Dive-domain review: a unit that came home "service concern" and has had
   * no service since is the flagged regulator a busy dock would hand straight
   * back out. The picker still offers it, labelled; DiveDay never chooses it.
   */
  it("never proposes a unit whose service concern nobody has answered", () => {
    const flagged = { ...unit("Reg #1", null), serviceConcern: true };
    const free = new Map([["regulator", [flagged, unit("Reg #2", null)]]]);
    const rows = ["a", "b"].map((bookingId) => ({
      bookingId,
      wanted: [{ kind: "regulator", size: null }],
    }));
    const map = proposeRentalUnits(rows, free);
    expect(proposed(map, "a", "regulator")).toBe("Reg #2");
    expect(proposed(map, "b", "regulator")).toBeNull();
  });

  it("proposes a sizeless kind only from units with no size label", () => {
    // A mask labelled "Kids" or "RX -4.0" was labelled for somebody.
    const free = new Map([
      ["mask", [unit("Mask #1", "Kids"), unit("Mask #2", "RX -4.0"), unit("Mask #3", "  ")]],
    ]);
    const rows = ["a", "b"].map((bookingId) => ({
      bookingId,
      wanted: [{ kind: "mask", size: null }],
    }));
    const map = proposeRentalUnits(rows, free);
    expect(proposed(map, "a", "mask")).toBe("Mask #3");
    expect(proposed(map, "b", "mask")).toBeNull();
  });

  it("never proposes a regulator for a diver who asked for nitrox, and still proposes the rest", () => {
    // The register cannot yet say which regulators are O2-clean.
    const free = new Map([
      ["regulator", [unit("Reg #1", null)]],
      ["mask", [unit("Mask #1", null)]],
    ]);
    const map = proposeRentalUnits(
      [
        {
          bookingId: "a",
          wantsNitrox: true,
          wanted: [
            { kind: "regulator", size: null },
            { kind: "mask", size: null },
          ],
        },
        { bookingId: "b", wanted: [{ kind: "regulator", size: null }] },
      ],
      free,
    );
    expect(proposed(map, "a", "regulator")).toBeNull();
    expect(proposed(map, "a", "mask")).toBe("Mask #1");
    // The air diver after them still gets the regulator nobody else took.
    expect(proposed(map, "b", "regulator")).toBe("Reg #1");
  });

  it("proposes nothing for weights, even passed directly with a size that matches", () => {
    // Lead is bulk stock; the Gear tab filters it out before it gets here, and
    // the proposal does not lean on that.
    const free = new Map([["weights", [unit("Belt #1", "6 kg")]]]);
    const map = proposeRentalUnits(
      [{ bookingId: "a", wanted: [{ kind: "weights", size: "6 kg" }] }],
      free,
    );
    expect(map.size).toBe(0);
  });

  it("proposes nothing when no unit of the kind is free", () => {
    const map = proposeRentalUnits(
      [{ bookingId: "a", wanted: [{ kind: "bcd", size: "L" }] }],
      new Map(),
    );
    expect(map.size).toBe(0);
  });
});
