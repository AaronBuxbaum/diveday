import { describe, expect, it } from "vitest";
import { certificationAgency, certificationLevel } from "@/db/schema";
import { INTERNAL_VOCABULARY } from "@/test/copy";
import {
  IMPORT_AGENCIES,
  IMPORT_FIELDS,
  IMPORT_HONESTY_TABLE,
  IMPORT_LEVELS,
  isTechnicalCertName,
  MAX_IMPORT_BYTES,
  MAX_IMPORT_CELL_LENGTH,
  MAX_IMPORT_COLUMNS,
  MAX_IMPORT_ROWS,
  normalizeLevel,
  parseCsv,
  prepareContactImport,
} from "./import";

describe("parseCsv (RFC-4180)", () => {
  it("reads quoted fields, embedded commas, doubled quotes, and CRLF", () => {
    const text = 'a,b,c\r\n"x,y","she said ""hi""",z\r\n';
    expect(parseCsv(text)).toEqual([
      ["a", "b", "c"],
      ["x,y", 'she said "hi"', "z"],
    ]);
  });

  it("handles bare LF, a trailing row without a newline, and a leading BOM", () => {
    const text = "﻿name,email\nAda\n";
    expect(parseCsv(text)).toEqual([["name", "email"], ["Ada"]]);
  });

  it("keeps embedded newlines inside quotes", () => {
    expect(parseCsv('a\n"line1\nline2",b\n')).toEqual([["a"], ["line1\nline2", "b"]]);
  });
});

describe("enum arrays stay in step with the schema", () => {
  it("agencies and levels mirror the pg enums", () => {
    expect([...IMPORT_AGENCIES]).toEqual([...certificationAgency.enumValues]);
    expect([...IMPORT_LEVELS]).toEqual([...certificationLevel.enumValues]);
  });
});

describe("normalizeLevel", () => {
  it("maps agency dialects onto ladder rungs, advanced before open water", () => {
    expect(normalizeLevel("Advanced Open Water")).toBe("advanced_open_water");
    expect(normalizeLevel("AOW")).toBe("advanced_open_water");
    expect(normalizeLevel("Advanced Adventurer")).toBe("advanced_open_water"); // SSI's AOW
    expect(normalizeLevel("Advanced")).toBe("advanced_open_water");
    expect(normalizeLevel("Open Water Diver")).toBe("open_water");
    expect(normalizeLevel("OW")).toBe("open_water");
    expect(normalizeLevel("Rescue Diver")).toBe("rescue");
    expect(normalizeLevel("Divemaster")).toBe("divemaster");
    expect(normalizeLevel("Master Scuba Diver")).toBeNull();
    expect(normalizeLevel("")).toBeNull();
  });

  it("never reads a technical rating as a nearby recreational rung", () => {
    // The defect this closes: a bare /advanced/ rule read TDI Advanced Nitrox —
    // a decompression-adjacent gas certification — as Advanced Open Water, and a
    // ladder card clears its gate on `status` alone, so that handed a technical
    // diver's gas ticket a verified recreational clearance two rungs up.
    expect(normalizeLevel("Advanced Nitrox")).toBeNull();
    expect(normalizeLevel("TDI Advanced Nitrox Diver")).toBeNull();
    expect(normalizeLevel("Advanced Trimix")).toBeNull();
    expect(normalizeLevel("Helitrox Decompression Procedures")).toBeNull();
    expect(normalizeLevel("CCR Air Diluent")).toBeNull();
    expect(normalizeLevel("Full Cave")).toBeNull();
    expect(normalizeLevel("Intro to Tech")).toBeNull();
    expect(normalizeLevel("Extended Range")).toBeNull();
    expect(normalizeLevel("Advanced Sidemount")).toBeNull();
    // And the recreational rungs still resolve — the guard is not a blanket
    // refusal of anything with "advanced" in it.
    expect(normalizeLevel("Advanced Open Water Diver")).toBe("advanced_open_water");
  });

  it("names a technical rating so the reason can be shown, and doesn't over-claim", () => {
    expect(isTechnicalCertName("Advanced Nitrox")).toBe(true);
    expect(isTechnicalCertName("Full Cave Diver")).toBe(true);
    // A recreational specialty is not "technical" — it just isn't a rung, and
    // gets the ordinary "isn't a level we gate on" note instead.
    expect(isTechnicalCertName("Sidemount")).toBe(false);
    expect(isTechnicalCertName("Advanced Open Water")).toBe(false);
    expect(isTechnicalCertName("Rescue Diver")).toBe(false);
  });
});

describe("prepareContactImport — mapping", () => {
  it("maps every field from its own name, so no field shadows another", () => {
    // Header matching walks IMPORT_FIELDS in order and takes the first field
    // that claims a header, so an alias shared between two fields would make the
    // later one unreachable — silently, and with the shop's column landing on the
    // wrong thing. A file whose headers are exactly the canonical field names
    // must therefore map each one to itself, all 27, none swallowed.
    const headers = IMPORT_FIELDS.join(",");
    const prepared = prepareContactImport(`${headers}\n${IMPORT_FIELDS.map(() => "x").join(",")}`);
    expect(prepared.fatal).toBeNull();
    expect(prepared.mapping.map((m) => m.field)).toEqual([...IMPORT_FIELDS]);
    expect(prepared.unmappedColumns).toEqual([]);
  });

  it("auto-maps rival header dialects and flags medical + unmapped columns", () => {
    const csv = [
      "First Name,Last Name,E-mail,Cell,Cert Level,Cert Number,Medical Notes,Loyalty Tier",
      "Ada,Lovelace,ada@example.com,305-555-0101,Open Water,OW-1,none,gold",
    ].join("\n");
    const prepared = prepareContactImport(csv);
    expect(prepared.fatal).toBeNull();
    const fields = prepared.mapping.map((m) => m.field);
    expect(fields).toEqual(
      expect.arrayContaining([
        "first_name",
        "last_name",
        "email",
        "phone",
        "certification_level",
        "certification_number",
      ]),
    );
    expect(prepared.ignoredMedicalColumns).toContain("Medical Notes");
    expect(prepared.unmappedColumns).toContain("Loyalty Tier");
  });

  it("is fatal when no name column is present", () => {
    const prepared = prepareContactImport("email,phone\nada@example.com,305");
    expect(prepared.fatal).toMatch(/name column/i);
    expect(prepared.rows).toHaveLength(0);
  });

  it("assembles a full name from first + last", () => {
    const prepared = prepareContactImport("first_name,last_name\nGrace,Hopper");
    expect(prepared.rows[0]).toMatchObject({ fullName: "Grace Hopper", action: "import" });
  });
});

describe("prepareContactImport — explicit bounds (CR-016)", () => {
  it("rejects a file over the byte limit with a friendly reason and no rows", () => {
    const oversizedName = "x".repeat(MAX_IMPORT_BYTES + 1);
    const prepared = prepareContactImport(`full_name\n${oversizedName}`);
    expect(prepared.fatal).toMatch(/too large/i);
    expect(prepared.rows).toHaveLength(0);
  });

  it("rejects a file with more columns than the limit", () => {
    const headers = Array.from({ length: MAX_IMPORT_COLUMNS + 1 }, (_, i) => `col${i}`).join(",");
    const prepared = prepareContactImport(`full_name,${headers}\nAda,x`);
    expect(prepared.fatal).toMatch(/too many columns/i);
  });

  it("rejects a file with more rows than the limit", () => {
    const rows = Array.from({ length: MAX_IMPORT_ROWS + 1 }, (_, i) => `Diver ${i}`).join("\n");
    const prepared = prepareContactImport(`full_name\n${rows}`);
    expect(prepared.fatal).toMatch(/too many rows/i);
    expect(prepared.rows).toHaveLength(0);
  });

  it("accepts a file right at the row limit", () => {
    const rows = Array.from({ length: MAX_IMPORT_ROWS }, (_, i) => `Diver ${i}`).join("\n");
    const prepared = prepareContactImport(`full_name\n${rows}`);
    expect(prepared.fatal).toBeNull();
    expect(prepared.rows).toHaveLength(MAX_IMPORT_ROWS);
  });

  it("rejects a single cell over the length limit instead of silently truncating it", () => {
    const hugeCell = "x".repeat(MAX_IMPORT_CELL_LENGTH + 1);
    const prepared = prepareContactImport(`full_name\n${hugeCell}`);
    expect(prepared.fatal).toMatch(/longer than/i);
    expect(prepared.rows).toHaveLength(0);
  });
});

describe("prepareContactImport — safety rules", () => {
  it("imports a card as verified-and-flagged, carrying the row's source label", () => {
    const csv = [
      "full_name,certification_agency,certification_level,certification_number,prior_shop",
      "Jacques Cousteau,PADI,Rescue Diver,RES-42,Calypso Divers",
    ].join("\n");
    const [row] = prepareContactImport(csv).rows;
    // The prepared card carries the prior-shop provenance; the DB write lands it
    // `verified` + flagged imported (see src/db/import.test.ts).
    expect(row.cert).toEqual({
      agency: "padi",
      level: "rescue",
      identifier: "RES-42",
      sourceLabel: "Calypso Divers",
      expiresAt: null,
      status: "verified",
    });
    expect(
      row.issues.some((i) => /imported as verified/i.test(i.message) && /confirm/i.test(i.message)),
    ).toBe(true);
  });

  it("imports a card with a null source label when the row names no prior shop", () => {
    const csv =
      "full_name,certification_agency,certification_level,certification_number\nMarie Tharp,PADI,Open Water,OW-7";
    const [row] = prepareContactImport(csv).rows;
    expect(row.cert).toEqual({
      agency: "padi",
      level: "open_water",
      identifier: "OW-7",
      sourceLabel: null,
      expiresAt: null,
      status: "verified",
    });
  });

  it("never fabricates a card number: a level with no number imports no card", () => {
    const csv = "full_name,certification_level\nMarie Tharp,Open Water";
    const [row] = prepareContactImport(csv).rows;
    expect(row.cert).toBeNull();
    expect(
      row.issues.some((i) => i.level === "warning" && /no usable card number/i.test(i.message)),
    ).toBe(true);
  });

  it("declines a technical rating and says why, rather than importing a nearby rung", () => {
    // "or just show that it didn't import and why" — the row imports the diver,
    // no card, and the note names the reason in the shop's own terms.
    const csv =
      "full_name,certification_agency,certification_level,certification_number\nTec Tina,TDI,Advanced Nitrox,AN-88";
    const [row] = prepareContactImport(csv).rows;
    expect(row.action).toBe("import");
    expect(row.cert).toBeNull();
    expect(row.specialties).toEqual([]);
    expect(
      row.issues.some(
        (i) =>
          i.level === "warning" &&
          /technical or overhead-environment rating/i.test(i.message) &&
          /not imported/i.test(i.message),
      ),
    ).toBe(true);
    // Specifically not the old outcome: no Advanced Open Water card anywhere.
    expect(row.issues.some((i) => /advanced open water/i.test(i.message))).toBe(false);
  });

  it("leaves an unrecognized level for a human, importing the person anyway", () => {
    // "Master Scuba Diver" is a real PADI recognition and perfectly recreational,
    // it just isn't a rung DiveDay gates on — so it gets the generic note. (This
    // case used "Tec 40", which now gets the more specific technical-rating note.)
    const csv =
      "full_name,certification_level,certification_number\nEugenie Clark,Master Scuba Diver,MSD-40";
    const [row] = prepareContactImport(csv).rows;
    expect(row.action).toBe("import");
    expect(row.cert).toBeNull();
    expect(row.issues.some((i) => /isn't a level/i.test(i.message))).toBe(true);
  });

  it("maps an unknown agency to 'other' rather than dropping the card", () => {
    const csv =
      "full_name,certification_agency,certification_level,certification_number\nSylvia Earle,CMAS,Divemaster,DM-9";
    const [row] = prepareContactImport(csv).rows;
    expect(row.cert).toMatchObject({ agency: "other", level: "divemaster" });
  });

  it("imports nitrox as a verified-and-flagged card only with a card number", () => {
    const withNumber = prepareContactImport(
      "full_name,nitrox_certified,nitrox_certification_number\nA Diver,yes,NX-1",
    ).rows[0];
    expect(withNumber.nitrox).toEqual({
      agency: "other",
      identifier: "NX-1",
      sourceLabel: null,
      status: "verified",
    });
    expect(
      withNumber.issues.some(
        (i) => /imported as verified/i.test(i.message) && /confirm/i.test(i.message),
      ),
    ).toBe(true);

    const flagOnly = prepareContactImport("full_name,nitrox_certified\nB Diver,yes").rows[0];
    expect(flagOnly.nitrox).toBeNull();
    expect(flagOnly.issues.some((i) => /add and verify a nitrox card/i.test(i.message))).toBe(true);
  });

  it("imports a specialty card from an explicit specialty column and its own number", () => {
    const csv = [
      "full_name,certification_agency,specialty,specialty_certification_number,prior_shop",
      "Deep Diver,PADI,Deep Diver,DP-11,Calypso Divers",
    ].join("\n");
    const [row] = prepareContactImport(csv).rows;
    expect(row.specialties).toEqual([
      {
        agency: "padi",
        specialty: "deep",
        identifier: "DP-11",
        sourceLabel: "Calypso Divers",
        expiresAt: null,
        status: "verified",
      },
    ]);
    // The card is verified on arrival, but the gate is not: say both, and say
    // what the confirm asserts rather than that it's one tap (H-24).
    expect(
      row.issues.some(
        (i) =>
          /imported as verified/i.test(i.message) &&
          /waits until a staffer confirms they've seen the card/i.test(i.message),
      ),
    ).toBe(true);
  });

  it("reads a specialty out of a certification row that names one, and files no ladder card", () => {
    // The one-row-per-certification shape a rival's cert export actually emits.
    const csv = [
      "full_name,certification_agency,certification_level,certification_number",
      "Wreck Fan,SSI,Wreck Diver,WR-3",
    ].join("\n");
    const [row] = prepareContactImport(csv).rows;
    expect(row.specialties).toEqual([
      expect.objectContaining({ specialty: "wreck", identifier: "WR-3", agency: "ssi" }),
    ]);
    expect(row.cert).toBeNull();
    // Not "isn't a level we gate on" — it *is* a card we gate on, just not a rung.
    expect(row.issues.some((i) => /isn't a level/i.test(i.message))).toBe(false);
  });

  it("keeps a real ladder rung out of the specialty path", () => {
    const csv =
      "full_name,certification_level,certification_number\nLadder Only,Advanced Open Water,AOW-1";
    const [row] = prepareContactImport(csv).rows;
    expect(row.specialties).toEqual([]);
    expect(row.cert).toMatchObject({ level: "advanced_open_water", identifier: "AOW-1" });
  });

  it("reads 'Advanced Wreck Diver' as the wreck specialty, not the Advanced rung", () => {
    const csv =
      "full_name,certification_level,certification_number\nAmbiguous,Advanced Wreck Diver,AW-1";
    const [row] = prepareContactImport(csv).rows;
    expect(row.specialties).toEqual([expect.objectContaining({ specialty: "wreck" })]);
    expect(row.cert).toBeNull();
  });

  it("never files a specialty-named level column as a ladder card, even alongside a specialty column", () => {
    // The sharp case: "Advanced Wreck Diver" is a penetration rating, and filing
    // it as a verified Advanced Open Water card would clear that gate on the spot.
    const csv =
      "full_name,certification_level,certification_number,specialty,specialty_certification_number\nBoth,Advanced Wreck Diver,AW-2,Deep Diver,DP-2";
    const [row] = prepareContactImport(csv).rows;
    expect(row.cert).toBeNull();
    expect(row.specialties).toEqual([expect.objectContaining({ specialty: "deep" })]);
    expect(row.issues.some((i) => /names a specialty, not a level/i.test(i.message))).toBe(true);
  });

  it("imports every specialty a cell names, under the diver's one agency number", () => {
    // An agency number identifies the diver, not the card, so a "Deep & Wreck"
    // cell is two cards under one number — not a conflict to refuse.
    const csv = "full_name,specialty,specialty_certification_number\nTwo Cards,Deep & Wreck,ONE-1";
    const [row] = prepareContactImport(csv).rows;
    expect(row.specialties.map((c) => c.specialty).sort()).toEqual(["deep", "wreck"]);
    expect(row.specialties.every((c) => c.identifier === "ONE-1")).toBe(true);
  });

  it("uses the row's card number for a specialty column that has no number of its own", () => {
    // A PADI diver's Deep card carries the same PADI number as their level card.
    const csv =
      "full_name,certification_level,certification_number,specialty\nOne Number,Open Water,PADI-9,Deep Diver";
    const [row] = prepareContactImport(csv).rows;
    expect(row.cert).toMatchObject({ level: "open_water", identifier: "PADI-9" });
    expect(row.specialties).toEqual([
      expect.objectContaining({ specialty: "deep", identifier: "PADI-9" }),
    ]);
  });

  it("never fabricates a specialty card number", () => {
    const noNumber = prepareContactImport("full_name,specialty\nNo Number,Night Diver").rows[0];
    expect(noNumber.specialties).toEqual([]);
    expect(
      noNumber.issues.some((i) => i.level === "warning" && /no card number/i.test(i.message)),
    ).toBe(true);
  });

  it("declines a card number too long to key an index on, instead of failing the import", () => {
    const huge = "X".repeat(200);
    const csv = `full_name,certification_level,certification_number\nLong Number,Open Water,${huge}`;
    const [row] = prepareContactImport(csv).rows;
    expect(row.cert).toBeNull();
    expect(row.action).toBe("import");
    expect(row.issues.some((i) => /no usable card number/i.test(i.message))).toBe(true);
  });

  it("leaves a specialty it doesn't gate on for a human", () => {
    const csv = "full_name,specialty,specialty_certification_number\nSidemount Fan,Sidemount,SM-1";
    const [row] = prepareContactImport(csv).rows;
    expect(row.action).toBe("import");
    expect(row.specialties).toEqual([]);
    expect(row.issues.some((i) => /isn't a specialty we gate on/i.test(i.message))).toBe(true);
  });

  it("merges a repeated email's cards onto the same diver instead of discarding them", () => {
    // The shape of a certification export: one row per card, so a three-card
    // diver appears three times. Treating rows 2-3 as duplicate people is how
    // every card after the first used to be silently dropped.
    const csv = [
      "full_name,email,certification_agency,certification_level,certification_number",
      "Multi Card,multi@example.com,PADI,Advanced Open Water,AOW-5",
      "Multi Card,multi@example.com,PADI,Deep Diver,AOW-5",
      "Multi Card,multi@example.com,PADI,Wreck Diver,AOW-5",
    ].join("\n");
    const prepared = prepareContactImport(csv);
    expect(prepared.rows.map((r) => r.action)).toEqual(["import", "merge", "merge"]);
    expect(prepared.rows[1].mergedIntoRow).toBe(1);
    // Every card survives — one ladder card and two specialty cards.
    expect(prepared.rows[0].cert).toMatchObject({ level: "advanced_open_water" });
    expect(prepared.rows[1].specialties).toEqual([expect.objectContaining({ specialty: "deep" })]);
    expect(prepared.rows[2].specialties).toEqual([expect.objectContaining({ specialty: "wreck" })]);
    expect(prepared.totals).toMatchObject({ importable: 1, merged: 2, skipped: 0, withCard: 1 });
    expect(prepared.totals.withSpecialty).toBe(2);
  });

  it("still skips a nameless row outright", () => {
    const prepared = prepareContactImport("full_name,email\n,orphan@example.com");
    expect(prepared.rows[0].action).toBe("skip");
    expect(prepared.rows[0].cert).toBeNull();
  });

  it("recognizes the staff-facing “refresher due” header, not only expiry spellings", () => {
    // The label the app and the switching pages both use — a shop copying our
    // own wording into their sheet must not have the column silently ignored.
    const [row] = prepareContactImport(
      "full_name,certification_level,certification_number,refresher_due\nRefresher Rae,Rescue Diver,RS-77,2031-03-02",
    ).rows;
    expect(row.cert).toMatchObject({ identifier: "RS-77", expiresAt: "2031-03-02" });
  });

  it("carries a card expiry across, including one already past", () => {
    const csv = [
      "full_name,certification_level,certification_number,certification_expires_at",
      "Expiring,Rescue Diver,RS-1,2030-06-01",
      "Expired,Rescue Diver,RS-2,2020-06-01",
    ].join("\n");
    const rows = prepareContactImport(csv).rows;
    expect(rows[0].cert).toMatchObject({ expiresAt: "2030-06-01" });
    // A past date is a fact readiness must see, not something to drop: the
    // alternative is a migrated card that looks valid forever.
    expect(rows[1].cert).toMatchObject({ expiresAt: "2020-06-01" });
  });

  it("imports a card for staff review when its refresher-due date can't be read", () => {
    const csv =
      "full_name,certification_level,certification_number,card_expiry\nBad Date,Rescue Diver,RS-3,next June";
    const [row] = prepareContactImport(csv).rows;
    // Fails closed: an unreadable gate input must not become a card that never
    // comes due, so the card lands pending for a staffer instead.
    expect(row.cert).toMatchObject({ identifier: "RS-3", expiresAt: null, status: "pending" });
    expect(
      row.issues.some((i) => i.level === "warning" && /can't be read as a date/i.test(i.message)),
    ).toBe(true);
  });

  it("reads the date formats real exports emit, and refuses a sentinel year", () => {
    const read = (value: string) =>
      prepareContactImport(
        `full_name,certification_level,certification_number,card_expiry\nD,Rescue Diver,RS-9,${value}`,
      ).rows[0].cert;
    // US-locale Windows (EVE) and spreadsheet defaults, not ISO alone.
    expect(read("05/04/2030")).toMatchObject({ expiresAt: "2030-05-04" });
    expect(read("4-May-2030")).toMatchObject({ expiresAt: "2030-05-04" });
    // Quoted because the value itself contains the CSV separator.
    expect(read('"May 4, 2030"')).toMatchObject({ expiresAt: "2030-05-04" });
    // First part > 12 can only be a day, so that file is read day-first.
    expect(read("25/12/2030")).toMatchObject({ expiresAt: "2030-12-25" });
    // "Never expires" sentinels and impossible years are not dates we believe.
    expect(read("9999-12-31")).toMatchObject({ expiresAt: null, status: "pending" });
    expect(read("0000-01-01")).toMatchObject({ expiresAt: null, status: "pending" });
  });

  it("imports a card for staff review when the file itself says it was never verified", () => {
    const csv = [
      "full_name,certification_level,certification_number,cert_status",
      "Unverified Uma,Open Water,OW-11,unverified",
    ].join("\n");
    const [row] = prepareContactImport(csv).rows;
    // The whole verified-on-import posture rests on the prior system having
    // checked the card. Here it says it didn't.
    expect(row.cert).toMatchObject({ identifier: "OW-11", status: "pending" });
    expect(row.issues.some((i) => /don't call it checked/i.test(i.message))).toBe(true);
  });

  it("carries dive insurance across as the free text the file holds", () => {
    const [row] = prepareContactImport("full_name,dan_number\nInsured Diver,DAN #12345").rows;
    expect(row.diveInsurance).toBe("DAN #12345");
  });

  it("drops a malformed email so it can't mis-match a diver on dedup", () => {
    const [row] = prepareContactImport("full_name,email\nBad Row,not-an-email").rows;
    expect(row.email).toBeNull();
    expect(row.issues.some((i) => /doesn't look valid/i.test(i.message))).toBe(true);
  });

  it("skips a nameless row, and folds a repeated email onto the first row's diver", () => {
    const csv = [
      "full_name,email",
      ",orphan@example.com",
      "First Wins,dupe@example.com",
      "Second Loses,DUPE@example.com",
    ].join("\n");
    const prepared = prepareContactImport(csv);
    expect(prepared.rows[0].action).toBe("skip"); // no name
    expect(prepared.rows[1].action).toBe("import");
    // Case-insensitive, and the same diver — the contact details of row 2 win,
    // but the row is not thrown away: any evidence on it lands on that diver.
    expect(prepared.rows[2].action).toBe("merge");
    expect(prepared.rows[2].mergedIntoRow).toBe(2);
    expect(prepared.totals).toMatchObject({ total: 3, importable: 1, merged: 1, skipped: 1 });
  });

  it("round-trips a cell the export guarded against spreadsheet-formula injection", () => {
    // export.ts prefixes a leading '=' with an apostrophe; the importer strips it.
    const [row] = prepareContactImport("full_name\n'=cmd").rows;
    expect(row.fullName).toBe("=cmd");
  });

  it("counts cards, specialties, and nitrox only among importable rows", () => {
    const csv = [
      "full_name,email,certification_level,certification_number,specialty,specialty_certification_number,nitrox_certified,nitrox_certification_number",
      "Keep,keep@example.com,Open Water,OW-1,Deep Diver,DP-1,yes,NX-1",
      ",skip@example.com,Open Water,OW-2,Deep Diver,DP-2,yes,NX-2",
    ].join("\n");
    const prepared = prepareContactImport(csv);
    expect(prepared.totals).toMatchObject({
      importable: 1,
      withCard: 1,
      withSpecialty: 1,
      withNitrox: 1,
    });
  });

  it("trusts a truthy waiver_accepted and carries the source label and document URLs through", () => {
    const csv = [
      "full_name,waiver_accepted,waiver_signed_at,waiver_source_name,waiver_document_url,medical_document_url",
      "Wanda Waiver,yes,2025-01-15,Old Shop,https://old.example.com/w.jpg,https://old.example.com/m.jpg",
    ].join("\n");
    const [row] = prepareContactImport(csv).rows;
    expect(row.waiver).toEqual({
      signedAt: "2025-01-15",
      sourceLabel: "Old Shop",
      documentUrl: "https://old.example.com/w.jpg",
      medicalDocumentUrl: "https://old.example.com/m.jpg",
    });
    expect(
      row.issues.some((i) =>
        /trusted from the prior shop, including medical clearance/.test(i.message),
      ),
    ).toBe(true);
  });

  it("leaves waiver null when waiver_accepted is absent or falsy", () => {
    expect(
      prepareContactImport("full_name,waiver_accepted\nNo Claim,no").rows[0].waiver,
    ).toBeNull();
    expect(prepareContactImport("full_name\nNo Column").rows[0].waiver).toBeNull();
  });

  it("drops an unparseable waiver_signed_at rather than misdating legal evidence", () => {
    const csv = "full_name,waiver_accepted,waiver_signed_at\nBad Date,yes,not-a-real-date";
    const [row] = prepareContactImport(csv).rows;
    expect(row.waiver).toMatchObject({ signedAt: null });
    expect(row.issues.some((i) => /isn't a real calendar date/.test(i.message))).toBe(true);
  });

  it("rejects an impossible calendar date the same way a malformed one is rejected", () => {
    const csv = "full_name,waiver_accepted,waiver_signed_at\nFeb Bad,yes,2025-02-31";
    const [row] = prepareContactImport(csv).rows;
    expect(row.waiver?.signedAt).toBeNull();
  });

  it("counts waivers only among importable rows", () => {
    const csv = [
      "full_name,email,waiver_accepted",
      "Keep,keep@example.com,yes",
      ",skip@example.com,yes",
    ].join("\n");
    expect(prepareContactImport(csv).totals.withWaiver).toBe(1);
  });
});

describe("IMPORT_HONESTY_TABLE", () => {
  it("uses only the two calm scope buckets — no alarm-red partial/never chips", () => {
    for (const row of IMPORT_HONESTY_TABLE) {
      expect(["included", "stays-behind"]).toContain(row.scope);
    }
  });

  it("keeps payment and booking history behind, with an honest reason", () => {
    const behind = IMPORT_HONESTY_TABLE.filter((row) => row.scope === "stays-behind").map(
      (r) => r.what,
    );
    expect(behind).toEqual(
      expect.arrayContaining(["Card on file / payment", "Booking, trip & service history"]),
    );
  });

  it("states waiver/medical acceptance as trusted and marked imported", () => {
    const waiver = IMPORT_HONESTY_TABLE.find(
      (r) => r.what === "Signed waivers & medical clearance",
    );
    expect(waiver?.scope).toBe("included");
    expect(waiver?.detail).toMatch(/trust/i);
    expect(waiver?.detail).toMatch(/imported/i);
  });

  it("marks certifications and nitrox as coming across verified and flagged imported", () => {
    const cert = IMPORT_HONESTY_TABLE.find((r) => r.what === "Certification card");
    expect(cert?.scope).toBe("included");
    expect(cert?.detail).toMatch(/verified/i);
    expect(cert?.detail).toMatch(/imported/i);

    const nitrox = IMPORT_HONESTY_TABLE.find((r) => r.what === "Enriched air (nitrox)");
    expect(nitrox?.scope).toBe("included");
    expect(nitrox?.detail).toMatch(/verified/i);
  });

  it("says waiver/medical documents accept both images and PDFs", () => {
    const docs = IMPORT_HONESTY_TABLE.find((r) => r.what === "Waiver / medical documents");
    expect(docs?.detail).toMatch(/pdf/i);
  });

  it("brings specialty cards across, and says the dive waits on the staff confirm", () => {
    const specialty = IMPORT_HONESTY_TABLE.find((r) => r.what?.startsWith("Specialty cards"));
    expect(specialty?.scope).toBe("included");
    expect(specialty?.detail).toMatch(/verified/i);
    // The gate rule is the whole reason this row can be honest — it must be
    // stated on the row itself, not buried in a page's surrounding prose.
    expect(specialty?.detail).toMatch(/confirm/i);
  });

  it("brings dive insurance across without implying it is a gate", () => {
    const insurance = IMPORT_HONESTY_TABLE.find((r) => r.what === "Dive insurance (DAN)");
    expect(insurance?.scope).toBe("included");
    expect(insurance?.detail).toMatch(/never a gate/i);
  });

  it("never leaks internal vocabulary into a table three surfaces render verbatim", () => {
    // This table is rendered on both switching pages and in the import wizard.
    // An ADR id or a decision-register id here reaches a shop owner as a dead
    // end — say the thing the reference points at instead.
    for (const row of IMPORT_HONESTY_TABLE) {
      expect(row.what, `${row.what} — what`).not.toMatch(INTERNAL_VOCABULARY);
      expect(row.detail, `${row.what} — detail`).not.toMatch(INTERNAL_VOCABULARY);
    }
  });
});
