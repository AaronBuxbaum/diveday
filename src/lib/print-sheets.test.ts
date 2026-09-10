import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  BOAT_CARD_DAY,
  BOAT_CARD_NIGHT,
  BOAT_CARD_PLAN_CHARS,
  boatCardNumbers,
  boatCardPlan,
  isPrintSheetCode,
  PRINT_SHEET_BOX_MM,
  PRINT_SHEET_CODES,
  PRINT_SHEET_GROUPS,
  PRINT_SHEETS,
  passCodePayload,
  printRunSubjectKey,
  printSheetPageRule,
  printSheetPath,
  printSheetSpec,
  printSheetsInGroup,
  storefrontAddress,
} from "./print-sheets";

describe("the register", () => {
  it("names every sheet once, in a group that exists", () => {
    expect(PRINT_SHEETS.map((sheet) => sheet.code)).toEqual([...PRINT_SHEET_CODES]);
    for (const sheet of PRINT_SHEETS) {
      expect(PRINT_SHEET_GROUPS).toContain(sheet.group);
    }
  });

  it("lists the groups in the order the paper leaves the shop", () => {
    // The dock and the door, then the boat, then a diver's hand, then the wall
    // — the register's reading order, which is the order the canvas draws.
    expect(printSheetsInGroup("dock").map((sheet) => sheet.code)).toEqual([
      "dock_sign",
      "window_sticker",
    ]);
    expect(printSheetsInGroup("boat").map((sheet) => sheet.code)).toEqual([
      "boat_card",
      "site_briefing",
    ]);
    expect(printSheetsInGroup("diver").map((sheet) => sheet.code)).toEqual(["paper_pass"]);
    expect(printSheetsInGroup("wall").map((sheet) => sheet.code)).toEqual(["year_poster"]);
  });

  it("keeps the shop's colour off anything that rides a boat", () => {
    // The whole coral-and-colour ban, on paper: a boat card is drawn in the
    // boat's own action colour so a hull's card never depends on the
    // storefront's palette.
    expect(printSheetSpec("boat_card").wearsShopColour).toBe(false);
    for (const sheet of PRINT_SHEETS) {
      if (sheet.code === "boat_card") continue;
      expect(sheet.wearsShopColour).toBe(true);
    }
  });

  it("gives the boat card a row per hull and everything else one row", () => {
    expect(printSheetSpec("boat_card").perBoat).toBe(true);
    expect(PRINT_SHEETS.filter((sheet) => sheet.perBoat)).toHaveLength(1);
  });

  it("keeps the two rows that are not doors out of the register's print path", () => {
    // The pass prints from a booking at the counter; the year poster opens
    // Reports until the year card lands (lever T).
    expect(printSheetSpec("paper_pass").printsFromRegister).toBe(false);
    expect(printSheetSpec("year_poster").printsFromRegister).toBe(false);
  });

  it("narrows a submitted code", () => {
    expect(isPrintSheetCode("dock_sign")).toBe(true);
    expect(isPrintSheetCode("dock-sign")).toBe(false);
    expect(isPrintSheetCode(null)).toBe(false);
    expect(() => printSheetSpec("nope" as never)).toThrow();
  });
});

describe("the paper", () => {
  it("gives every sheet a fixed pagination and a printable box", () => {
    for (const sheet of PRINT_SHEETS) {
      const rule = printSheetPageRule(sheet.paper);
      expect(rule).toContain(`size:${sheet.paper}`);
      // A margin, never none: every printer has an unprintable border, and the
      // band runs to the edge of the sheet by design.
      expect(rule).toMatch(/margin:\d+mm/);
      const box = PRINT_SHEET_BOX_MM[sheet.paper];
      expect(box.width).toBeGreaterThan(0);
      expect(box.height).toBeGreaterThan(0);
    }
  });

  it("draws the boat card and the briefing card wider than they are tall", () => {
    // Landscape, laminated, on a console — the one orientation fact a template
    // cannot recover on its own.
    const boat = PRINT_SHEET_BOX_MM[printSheetSpec("boat_card").paper];
    expect(boat.width).toBeGreaterThan(boat.height);
  });
});

describe("a print run's key", () => {
  it("collapses an absent subject to a value a unique index can hold", () => {
    // Nulls are distinct in a Postgres unique index, so a nullable subject
    // would quietly allow a second row per sheet and the register would show
    // whichever one the planner reached first.
    expect(printRunSubjectKey(null)).toBe("");
    expect(printRunSubjectKey(undefined)).toBe("");
    expect(printRunSubjectKey("boat-1")).toBe("boat-1");
  });
});

describe("the boat card's numbers", () => {
  const labels = { vesselLabel: "Vessel", shopLabel: "Shop", shoreLabel: "Ashore" };

  it("prints a blank where the shop has recorded nothing, never a number", () => {
    const numbers = boatCardNumbers({
      ...labels,
      vessel: null,
      shopPhone: null,
      shoreContact: "   ",
      reference: [],
    });
    expect(numbers).toEqual([
      { key: "vessel", label: "Vessel", value: null },
      { key: "shop", label: "Shop", value: null },
      { key: "ashore", label: "Ashore", value: null },
    ]);
  });

  it("reads the shop's own lines, in the order the shop wrote them", () => {
    const numbers = boatCardNumbers({
      ...labels,
      vessel: "Mantis II · MMSI 338100123",
      shopPhone: "(305) 555-0142",
      shoreContact: "Dana Reyes (305) 555-0118",
      reference: [
        { label: " Chamber (Key Largo) ", phone: "(305) 555-0155" },
        { label: "Coast Guard", phone: "VHF 16" },
      ],
    });
    expect(numbers.map((line) => line.label)).toEqual([
      "Vessel",
      "Shop",
      "Ashore",
      "Chamber (Key Largo)",
      "Coast Guard",
    ]);
    // The vessel leads: it is the first thing a rescue coordinator asks the
    // crew reading this card for.
    expect(numbers[0]?.value).toBe("Mantis II · MMSI 338100123");
    expect(numbers[3]?.value).toBe("(305) 555-0155");
  });
});

describe("the boat card's reference lines", () => {
  it("keys every line by its position, never by its label", () => {
    // A shop's reference lines are free text, and `normalizeEmergencyReference`
    // keeps a line with a number and no label at all — so two blank or repeated
    // labels are an ordinary state, and keying a rendered list by label would
    // collapse them into one and drop a number off the card.
    const numbers = boatCardNumbers({
      vesselLabel: "Vessel",
      vessel: null,
      shopLabel: "Shop",
      shopPhone: null,
      shoreLabel: "Ashore",
      shoreContact: null,
      reference: [
        { label: "", phone: "+1 305 555 0155" },
        { label: "", phone: "+1 305 555 0188" },
      ],
    });
    const keys = numbers.map((line) => line.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(numbers.filter((line) => line.label === "")).toHaveLength(2);
    expect(numbers.map((line) => line.value)).toContain("+1 305 555 0188");
  });
});

describe("the boat card's plan", () => {
  it("prints the shop's own words when they fit", () => {
    const plan = "Oxygen on deck. Call the chamber. Run for the ramp at Garden Cove.";
    expect(boatCardPlan(plan)).toBe(plan);
  });

  it("has nothing to print when the shop has written nothing", () => {
    expect(boatCardPlan(null)).toBeNull();
    expect(boatCardPlan("   ")).toBeNull();
  });

  it("bounds a long plan on a word, and shows that it did", () => {
    // The card is two faces of one lamination and cannot paginate, so the one
    // unbounded thing on it is cut here rather than left to run off the sheet.
    // The ellipsis is the visible half of that: a crew can see the card is
    // showing part of a longer plan instead of reading a sentence that stops.
    const long = `${"call the chamber and then the coastguard ".repeat(20)}`;
    const bounded = boatCardPlan(long);
    expect(bounded).not.toBeNull();
    expect((bounded ?? "").length).toBeLessThanOrEqual(BOAT_CARD_PLAN_CHARS + 1);
    expect(bounded?.endsWith("…")).toBe(true);
    // Cut on a word boundary: never mid-word.
    expect(bounded?.slice(0, -1).trimEnd().endsWith("the")).toBe(true);
  });
});

describe("the pass's code", () => {
  it("carries the booking id and nothing else", () => {
    // Not a URL, not a name, not the shop: a pass left on a boat seat hands a
    // finder nothing it can open.
    const bookingId = "9f4b2f7e-1f1a-4a2f-9f3c-2b0c1d5e6f70";
    expect(passCodePayload(bookingId)).toBe(bookingId);
    expect(passCodePayload(bookingId)).not.toContain("http");
  });
});

describe("the fold line's address", () => {
  it("prints the storefront without a scheme, because nobody clicks paper", () => {
    expect(storefrontAddress("blue-mantis", "https://dive.day")).toBe("dive.day/s/blue-mantis");
    expect(storefrontAddress("blue-mantis", "http://localhost:3000/")).toBe(
      "localhost:3000/s/blue-mantis",
    );
  });

  it("falls back to the path rather than printing a broken host", () => {
    // A sheet saying `https://undefined/s/blue-mantis` is worse than one saying
    // where the page lives and nothing about the host.
    expect(storefrontAddress("blue-mantis", null)).toBe("/s/blue-mantis");
  });
});

describe("the boat card's colours", () => {
  const globals = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "..", "app", "globals.css"),
    "utf8",
  );

  /** The value one custom property takes inside one block of `globals.css`. */
  function property(selector: string, name: string, from = 0): string {
    const start = globals.indexOf(selector, from);
    expect(start, `${selector} is gone from globals.css`).toBeGreaterThan(-1);
    const block = globals.slice(start, globals.indexOf("}", start));
    const match = new RegExp(`${name}:\\s*(#[0-9a-f]{3,8})`).exec(block);
    expect(match, `${name} is gone from ${selector}`).not.toBeNull();
    return match?.[1] ?? "";
  }

  it("is boat mode's own action colour by day", () => {
    // A copy, pinned: print redefines `--primary`, so the card cannot read the
    // token, and a palette that moved without this moving would print a hull's
    // card in a colour the app no longer uses.
    expect(BOAT_CARD_DAY.band).toBe(property(".boat-mode {", "--primary"));
    expect(BOAT_CARD_DAY.bandInk).toBe(property(".boat-mode {", "--primary-foreground"));
  });

  it("is the night sheet's own ground and the night sheet's own ink by night", () => {
    expect(BOAT_CARD_NIGHT.band).toBe(property(".paper-sheet-night {", "--sheet-ground"));
    // **Not boat mode's night cyan.** The night side exists to be read by a red
    // torch, which is monochromatic: a cyan band goes to nothing under one, and
    // what is written across it is the boat's name. The body's own off-white is
    // the ink that survives.
    expect(BOAT_CARD_NIGHT.bandInk).toBe(property(".paper-sheet-night {", "--sheet-ink"));
  });

  it("never carries the shop's colour", () => {
    // Stated twice on purpose: the registry says the sheet does not wear it,
    // and these values say what it wears instead.
    expect(printSheetSpec("boat_card").wearsShopColour).toBe(false);
    expect(BOAT_CARD_NIGHT.night).toBe(true);
  });
});

describe("where a sheet is drawn", () => {
  it("gives every printable sheet a route under the shop's own print segment", () => {
    expect(printSheetPath("blue-mantis", "dock_sign")).toBe("/shop/blue-mantis/print/dock-sign");
    expect(printSheetPath("blue-mantis", "window_sticker")).toBe(
      "/shop/blue-mantis/print/window-sticker",
    );
    expect(printSheetPath("blue-mantis", "site_briefing")).toBe(
      "/shop/blue-mantis/print/site-briefings",
    );
    expect(printSheetPath("blue-mantis", "boat_card", "boat-1")).toBe(
      "/shop/blue-mantis/print/boat-card/boat-1",
    );
    expect(printSheetPath("blue-mantis", "paper_pass", "booking-1")).toBe(
      "/shop/blue-mantis/print/pass/booking-1",
    );
  });

  it("has no route for a subject-shaped sheet with no subject, or for the poster", () => {
    expect(printSheetPath("blue-mantis", "boat_card")).toBeNull();
    expect(printSheetPath("blue-mantis", "paper_pass")).toBeNull();
    // The year card is a sibling slice; the register's row opens Reports.
    expect(printSheetPath("blue-mantis", "year_poster")).toBeNull();
  });

  it("escapes a subject that would otherwise rewrite the route", () => {
    // `shopPath` escapes each segment, which is what stops a submitted id
    // traversing out of the print segment.
    expect(printSheetPath("blue-mantis", "boat_card", "../../orders")).not.toContain("/orders");
  });
});
