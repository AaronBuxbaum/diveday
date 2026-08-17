import { describe, expect, it } from "vitest";
import { certificationAgency, certificationLevel } from "@/db/schema";
import { diverTranslator } from "@/i18n/messages";
import { INTERNAL_VOCABULARY } from "@/test/copy";
import {
  IMPORT_AGENCIES,
  IMPORT_FIELDS,
  IMPORT_HONESTY_TABLE,
  IMPORT_LEVELS,
  type ImportScopeRowId,
  importedPaymentDirection,
  importedPaymentHistoryDedupeKey,
  isTechnicalCertName,
  MAX_IMPORT_BYTES,
  MAX_IMPORT_CELL_LENGTH,
  MAX_IMPORT_COLUMNS,
  MAX_IMPORT_ROWS,
  normalizeLevel,
  parseCsv,
  parseImportedMoney,
  prepareContactImport,
  priorVisitDedupeKey,
} from "./import";
import { IMPORT_SCOPE_ROW_KEYS } from "./migration-guides";

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
    // must therefore map each one to itself, all of them, none swallowed.
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
    expect(prepared.fatal?.code).toBe("no_name_column");
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
    expect(prepared.fatal?.code).toBe("file_too_large");
    expect(prepared.rows).toHaveLength(0);
  });

  it("rejects a file with more columns than the limit", () => {
    const headers = Array.from({ length: MAX_IMPORT_COLUMNS + 1 }, (_, i) => `col${i}`).join(",");
    const prepared = prepareContactImport(`full_name,${headers}\nAda,x`);
    expect(prepared.fatal?.code).toBe("too_many_columns");
  });

  it("rejects a file with more rows than the limit", () => {
    const rows = Array.from({ length: MAX_IMPORT_ROWS + 1 }, (_, i) => `Diver ${i}`).join("\n");
    const prepared = prepareContactImport(`full_name\n${rows}`);
    expect(prepared.fatal?.code).toBe("too_many_rows");
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
    expect(prepared.fatal?.code).toBe("cell_too_long_row");
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
    expect(row.issues.some((i) => i.code === "cert_imported_verified")).toBe(true);
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
    expect(row.issues.some((i) => i.level === "warning" && i.code === "level_no_card_number")).toBe(
      true,
    );
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
    expect(row.issues.some((i) => i.level === "warning" && i.code === "level_is_technical")).toBe(
      true,
    );
    // Specifically not the old outcome: no Advanced Open Water card (or any
    // card) ever got imported for this row.
    expect(
      row.issues.some(
        (i) => i.code === "cert_imported_verified" || i.code === "cert_imported_pending",
      ),
    ).toBe(false);
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
    expect(row.issues.some((i) => i.code === "level_not_gated")).toBe(true);
  });

  it("maps an unknown agency to 'other' rather than dropping the card", () => {
    // The enum is not exhaustive and never will be (IANTD, SEI, ANDI, ACUC,
    // PSAI, NASE are all still out), so the card still has to land — under
    // "other" rather than being thrown away, which is the behaviour this test
    // has always been about. (It used to say CMAS, then BSAC; both are real
    // values now — see below.)
    const csv =
      "full_name,certification_agency,certification_level,certification_number\nSylvia Earle,IANTD,Divemaster,DM-9";
    const [row] = prepareContactImport(csv).rows;
    expect(row.cert).toMatchObject({ agency: "other", level: "divemaster" });
  });

  it("records a CMAS, RAID, GUE or BSAC card under its own agency (DOM-L1)", () => {
    // These four were absent from the enum, so an import filed an honest card
    // under "other" and the shop lost which agency issued it. Recording only —
    // nothing about admission or readiness reads the agency.
    const agencyOf = (name: string) =>
      prepareContactImport(
        `full_name,certification_agency,certification_level,certification_number\nA Diver,${name},Open Water,OW-1`,
      ).rows[0]?.cert?.agency;

    expect(agencyOf("CMAS")).toBe("cmas");
    expect(agencyOf("RAID")).toBe("raid");
    expect(agencyOf("GUE")).toBe("gue");
    expect(agencyOf("BSAC")).toBe("bsac");
    // And the agencies that already resolved still resolve to the same value —
    // the new names were appended after them, never inserted ahead.
    expect(agencyOf("PADI Open Water")).toBe("padi");
    expect(agencyOf("SDI")).toBe("sdi");
    // Real cell shapes: the separator is not always a space.
    expect(agencyOf("CMAS***")).toBe("cmas");
    expect(agencyOf("SDI/TDI")).toBe("sdi");
  });

  it("never reads a short agency code out of the middle of a word", () => {
    // This column's header aliases include the bare "agency", and in a rival's
    // *bookings* export an "Agency" column is the travel agency or booking
    // source. Every cell below contains the three letters "gue", and a
    // substring match filed each as a GUE card — an unrecognized cell became a
    // *wrongly* recognized one, silently, because `agency_unrecognized` is
    // only raised when nothing matched at all. That is strictly worse than
    // `other`: a card labelled GUE that isn't fails the staffer's lookup in
    // GUE's own portal (20260721-manual-certification), so they either refuse a
    // certified diver at the rail or stop looking cards up — and the wrong
    // label prints on the incident-ready export handed to authorities.
    const rowFor = (agency: string) =>
      prepareContactImport(
        `full_name,certification_agency,certification_level,certification_number\nA Diver,${agency},Open Water,OW-1`,
      ).rows[0];

    const notAnAgency = [
      "Guest",
      "Guest Booking",
      "Direct Guest",
      // LIFRAS, the Belgian CMAS federation, as a European roster writes it —
      // and note it is a CMAS body, so "read it as GUE" is wrong twice over.
      "Ligue Francophone",
      "Ligue Francophone de Recherches et d'Activités Subaquatiques",
      // Not only "gue": other short codes hide inside ordinary names too.
      "Cassidy Travel", // ssi
      "Padilla Dive Center", // padi
    ];
    for (const cell of notAnAgency) {
      const row = rowFor(cell);
      expect(row.cert?.agency, cell).toBe("other");
      // Silence is the actual defect: the shop must still be *told*.
      expect(
        row.issues.some((i) => i.code === "agency_unrecognized"),
        cell,
      ).toBe(true);
    }

    // Positive control — matching whole tokens must not have narrowed the real
    // shapes a cell takes, and a genuine match still raises no issue.
    const real = rowFor("GUE");
    expect(real.cert?.agency).toBe("gue");
    expect(real.issues.some((i) => i.code === "agency_unrecognized")).toBe(false);
    expect(rowFor("GUE/DIR").cert?.agency).toBe("gue");
    expect(rowFor("PADI #4471").cert?.agency).toBe("padi");
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
    expect(withNumber.issues.some((i) => i.code === "nitrox_imported")).toBe(true);

    const flagOnly = prepareContactImport("full_name,nitrox_certified\nB Diver,yes").rows[0];
    expect(flagOnly.nitrox).toBeNull();
    expect(flagOnly.issues.some((i) => i.code === "nitrox_no_card_number")).toBe(true);
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
    expect(row.issues.some((i) => i.code === "specialty_imported_verified")).toBe(true);
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
    expect(row.issues.some((i) => i.code === "level_not_gated")).toBe(false);
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
    expect(row.issues.some((i) => i.code === "level_names_specialty")).toBe(true);
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
      noNumber.issues.some((i) => i.level === "warning" && i.code === "specialty_no_card_number"),
    ).toBe(true);
  });

  it("declines a card number too long to key an index on, instead of failing the import", () => {
    const huge = "X".repeat(200);
    const csv = `full_name,certification_level,certification_number\nLong Number,Open Water,${huge}`;
    const [row] = prepareContactImport(csv).rows;
    expect(row.cert).toBeNull();
    expect(row.action).toBe("import");
    expect(row.issues.some((i) => i.code === "level_no_card_number")).toBe(true);
  });

  it("leaves a specialty it doesn't gate on for a human", () => {
    const csv = "full_name,specialty,specialty_certification_number\nSidemount Fan,Sidemount,SM-1";
    const [row] = prepareContactImport(csv).rows;
    expect(row.action).toBe("import");
    expect(row.specialties).toEqual([]);
    expect(row.issues.some((i) => i.code === "specialty_not_gated")).toBe(true);
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
    expect(row.issues.some((i) => i.level === "warning" && i.code === "expiry_unreadable")).toBe(
      true,
    );
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
    expect(row.issues.some((i) => i.code === "card_marked_unverified")).toBe(true);
  });

  it("carries dive insurance across as the free text the file holds", () => {
    const [row] = prepareContactImport("full_name,dan_number\nInsured Diver,DAN #12345").rows;
    expect(row.diveInsurance).toBe("DAN #12345");
  });

  it("drops a malformed email so it can't mis-match a diver on dedup", () => {
    const [row] = prepareContactImport("full_name,email\nBad Row,not-an-email").rows;
    expect(row.email).toBeNull();
    expect(row.issues.some((i) => i.code === "email_invalid")).toBe(true);
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

    // Also strips for tab and carriage return (which then get trimmed as whitespace)
    const [rowTab] = prepareContactImport("full_name\n'\tcmd").rows;
    expect(rowTab.fullName).toBe("cmd");

    const [rowCr] = prepareContactImport('full_name\n"\'\rcmd"').rows;
    expect(rowCr.fullName).toBe("cmd");
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
    expect(row.issues.some((i) => i.code === "waiver_imported")).toBe(true);
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
    expect(row.issues.some((i) => i.code === "waiver_date_invalid")).toBe(true);
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

describe("prepareContactImport — prior visits", () => {
  const bookingsExport = [
    "customer_name,email,booking_date,tour_name,booking_status,total,booking_id",
    "Hana Kobayashi,hana@example.com,2024-05-11,Two-tank Molasses Reef,Completed,$165.00,CCD-1",
    "Hana Kobayashi,hana@example.com,2025-02-02,Night dive Benwood,Cancelled,$95.00,CCD-2",
    "Sam Reed,sam@example.com,2025-06-30,Discover Scuba,Completed,$120.00,CCD-3",
  ].join("\n");

  it("reads a one-row-per-booking export as people, their visits, and separate source payment history", () => {
    const prepared = prepareContactImport(bookingsExport);
    // Two people; Hana's second booking is a merge row, not a duplicate person.
    expect(prepared.totals.importable).toBe(2);
    expect(prepared.totals.merged).toBe(1);
    expect(prepared.totals.withVisit).toBe(3);
    expect(prepared.totals.withPaymentHistory).toBe(3);
    expect(prepared.rows[1].action).toBe("merge");
    expect(prepared.rows[1].visit?.title).toBe("Night dive Benwood");
  });

  it("carries the source's status word and money text verbatim", () => {
    const [first] = prepareContactImport(bookingsExport).rows;
    expect(first.visit).toMatchObject({
      visitedOn: "2024-05-11",
      title: "Two-tank Molasses Reef",
      statusLabel: "Completed",
      amountLabel: "$165.00",
      sourceReference: "CCD-1",
    });
    expect(first.paymentHistory).toMatchObject({
      occurredOn: "2024-05-11",
      direction: "payment",
      statusLabel: "Completed",
      amountLabel: "$165.00",
      sourceReference: "CCD-1",
    });
  });

  it("keeps a cancelled booking rather than dropping it", () => {
    // The row is history either way; hiding it would misstate what the old
    // system held, and counting it as a dive would invent one. It comes in
    // carrying the word "Cancelled" and the profile renders that.
    const cancelled = prepareContactImport(bookingsExport).rows[1];
    expect(cancelled.visit?.statusLabel).toBe("Cancelled");
    // Cancelled only tells us this was not an ordinary settled payment. The
    // source row remains visible, but it cannot affect a financial aggregate.
    expect(cancelled.paymentHistory?.direction).toBe("unknown");
  });

  it("reads the date formats a real export writes, not just ISO", () => {
    const csv = [
      "full_name,email,trip_date,trip_name",
      "US Locale,us@example.com,05/04/2024,Reef",
      "Day First,day@example.com,25/12/2024,Reef",
      "Written Out,out@example.com,4-May-2024,Reef",
    ].join("\n");
    const rows = prepareContactImport(csv).rows;
    expect(rows[0].visit?.visitedOn).toBe("2024-05-04");
    expect(rows[1].visit?.visitedOn).toBe("2024-12-25");
    expect(rows[2].visit?.visitedOn).toBe("2024-05-04");
  });

  it("declines a visit it cannot date rather than inventing one", () => {
    const csv = [
      "full_name,email,visit_date,trip_name",
      "No Date,nodate@example.com,sometime last summer,Reef",
    ].join("\n");
    const [row] = prepareContactImport(csv).rows;
    expect(row.visit).toBeNull();
    // The diver still imports — one unreadable date is not a reason to drop a person.
    expect(row.action).toBe("import");
    expect(row.issues.some((issue) => issue.code === "visit_date_unreadable")).toBe(true);
  });

  it("says so when a row names a booking but carries no date column at all", () => {
    const csv = ["full_name,email,tour_name,total", "No Date,nd@example.com,Reef,$100"].join("\n");
    const [row] = prepareContactImport(csv).rows;
    expect(row.visit).toBeNull();
    expect(row.issues.some((issue) => issue.code === "visit_no_date")).toBe(true);
  });

  it("never builds a visit from a skipped row", () => {
    const csv = [
      "full_name,email,visit_date,tour_name",
      ",noname@example.com,2024-05-11,Reef",
    ].join("\n");
    const [row] = prepareContactImport(csv).rows;
    expect(row.action).toBe("skip");
    expect(row.visit).toBeNull();
  });

  it("lets specific columns win their headers over the generic visit aliases", () => {
    // "status" belongs to certification_status and "date signed" to the waiver,
    // even though the visit field lists generic aliases of its own.
    const csv = [
      "full_name,email,certification_number,status,date_signed,waiver_accepted,visit_date",
      "Both,both@example.com,PADI-1,verified,2024-02-02,yes,2024-05-11",
    ].join("\n");
    const prepared = prepareContactImport(csv);
    const fields = Object.fromEntries(prepared.mapping.map((m) => [m.header, m.field]));
    expect(fields.status).toBe("certification_status");
    expect(fields.date_signed).toBe("waiver_signed_at");
    expect(fields.visit_date).toBe("visit_date");
  });
});

describe("prepareContactImport — imported payment and receipt history", () => {
  it("keeps explicit financial fields separate from a generic booking row", () => {
    const csv = [
      "full_name,email,payment_date,payment_status,payment_amount,payment_currency,payment_direction,payment_reference,receipt_number,receipt_url,stripe_invoice_id",
      "Rosa Receipt,rosa@example.com,2024-05-11,Settled,165.00,USD,payment,pay_42,receipt_42,/import-receipts/receipt.pdf,in_42",
    ].join("\n");
    const [row] = prepareContactImport(csv).rows;
    expect(row.visit).toBeNull();
    expect(row.paymentHistory).toMatchObject({
      occurredOn: "2024-05-11",
      direction: "payment",
      statusLabel: "Settled",
      amountLabel: "165.00",
      currencyLabel: "USD",
      paymentReference: "pay_42",
      receiptReference: "receipt_42",
      receiptDocumentUrl: "/import-receipts/receipt.pdf",
      stripeReference: "in_42",
    });
  });

  it("drops source payment history without a usable date rather than inventing one", () => {
    const [row] = prepareContactImport(
      "full_name,payment_amount,payment_currency\nNo Date,165.00,USD",
    ).rows;
    expect(row.action).toBe("import");
    expect(row.paymentHistory).toBeNull();
    expect(row.issues.some((issue) => issue.code === "payment_history_no_date")).toBe(true);
  });

  it("does not map card-number or reusable-payment fields", () => {
    const prepared = prepareContactImport(
      "full_name,card_number,cvc,payment_method_id\nNo Credentials,4242424242424242,123,pm_secret",
    );
    expect(prepared.mapping.map((entry) => entry.field)).toEqual(["full_name"]);
    expect(prepared.unmappedColumns).toEqual(["card_number", "cvc", "payment_method_id"]);
  });
});

describe("imported payment evidence helpers", () => {
  it("classifies only clear source directions", () => {
    expect(
      importedPaymentDirection({
        directionLabel: "payment",
        statusLabel: null,
        amountLabel: "165",
      }),
    ).toBe("payment");
    expect(
      importedPaymentDirection({
        directionLabel: null,
        statusLabel: "Refunded",
        amountLabel: "95",
      }),
    ).toBe("refund");
    expect(
      importedPaymentDirection({
        directionLabel: null,
        statusLabel: "Cancelled",
        amountLabel: "95",
      }),
    ).toBe("unknown");
  });

  it("parses a source amount only with an unambiguous currency", () => {
    expect(parseImportedMoney("$165.00", null, "usd")).toEqual({
      amountCents: 16_500,
      currency: "usd",
    });
    expect(parseImportedMoney("US$165.00", null, "cad")).toEqual({
      amountCents: 16_500,
      currency: "usd",
    });
    expect(parseImportedMoney("160,00 €", null, "usd")).toEqual({
      amountCents: 16_000,
      currency: "eur",
    });
    expect(parseImportedMoney("165", null, "usd")).toBeNull();
    expect(parseImportedMoney("$165.00", null, "eur")).toBeNull();
    expect(parseImportedMoney("€165.00", "USD", "usd")).toBeNull();
    // The field is a Postgres integer. Keep an oversized source amount on its
    // unverified row rather than letting it abort the whole import on insert.
    expect(parseImportedMoney("USD 21474836.48", null, "usd")).toBeNull();
  });

  it("keeps independently referenced receipts distinct and makes re-imports stable", () => {
    const base = {
      occurredOn: "2024-05-11",
      direction: "payment" as const,
      title: "Reef",
      statusLabel: "Settled",
      amountLabel: "$165.00",
      paymentReference: null,
      receiptReference: "receipt_42",
      receiptDocumentUrl: null,
      sourceReference: null,
      stripeReference: null,
    };
    expect(importedPaymentHistoryDedupeKey(base)).toBe("receipt:receipt_42");
    expect(importedPaymentHistoryDedupeKey(base)).toBe(
      importedPaymentHistoryDedupeKey({ ...base }),
    );
  });
});

describe("priorVisitDedupeKey", () => {
  const visit = {
    visitedOn: "2024-05-11",
    title: "Two-tank",
    amountLabel: "$165.00",
    sourceReference: null as string | null,
  };

  it("keys on the source's booking reference when there is one", () => {
    expect(priorVisitDedupeKey({ ...visit, sourceReference: "CCD-1" })).toBe("ref:ccd-1");
    // Case and padding in the old system's id must not mint a second visit.
    expect(priorVisitDedupeKey({ ...visit, sourceReference: " ccd-1 " })).toBe("ref:ccd-1");
  });

  it("keys on the row's own content when the export carries no reference", () => {
    expect(priorVisitDedupeKey(visit)).toBe("row:2024-05-11|two-tank|$165.00");
  });

  it("separates two same-day bookings that differ in what they were", () => {
    const morning = priorVisitDedupeKey({ ...visit, title: "Two-tank AM" });
    const afternoon = priorVisitDedupeKey({ ...visit, title: "Two-tank PM" });
    expect(morning).not.toBe(afternoon);
  });

  it("collapses two indistinguishable same-day rows, as documented", () => {
    // The accepted trade-off: with no reference there is nothing to tell a real
    // duplicate booking from the same file imported twice, and silently doubling
    // a diver's history is the worse of the two errors.
    expect(priorVisitDedupeKey(visit)).toBe(priorVisitDedupeKey({ ...visit }));
  });
});

describe("IMPORT_HONESTY_TABLE", () => {
  // The table itself holds codes; the words live in the bundles. These
  // assertions read the published English through the diver-bundle map the
  // switching pages render from, so they still pin the copy a shop owner sees.
  const en = diverTranslator("en-US");
  const row = (id: ImportScopeRowId) => {
    const entry = IMPORT_HONESTY_TABLE.find((r) => r.id === id);
    expect(entry, `${id} row`).toBeDefined();
    return {
      scope: entry?.scope,
      what: en(IMPORT_SCOPE_ROW_KEYS[id].what),
      detail: en(IMPORT_SCOPE_ROW_KEYS[id].detail),
    };
  };

  it("uses only the two calm scope buckets — no alarm-red partial/never chips", () => {
    for (const entry of IMPORT_HONESTY_TABLE) {
      expect(["included", "stays-behind"]).toContain(entry.scope);
    }
  });

  it("has diver-bundle words for every row — no row can render as a bare key", () => {
    for (const entry of IMPORT_HONESTY_TABLE) {
      const keys = IMPORT_SCOPE_ROW_KEYS[entry.id];
      expect(en(keys.what), `${entry.id} what`).not.toBe(keys.what);
      expect(en(keys.detail), `${entry.id} detail`).not.toBe(keys.detail);
    }
  });

  it("keeps payment credentials and service history behind, while importing payment evidence separately", () => {
    const behind = IMPORT_HONESTY_TABLE.filter((entry) => entry.scope === "stays-behind").map(
      (entry) => entry.id,
    );
    expect(behind).toEqual(expect.arrayContaining(["cardOnFile", "serviceHistory"]));
    expect(row("cardOnFile").what).toBe("Credit card details");
    expect(row("cardOnFile").detail).toMatch(/never imports card numbers/i);
    expect(row("serviceHistory").what).toBe("Gear service history");

    const history = row("paymentHistory");
    expect(history.scope).toBe("included");
    expect(history.detail).toMatch(/unverified/i);
    expect(history.detail).toMatch(/never becomes a live Stripe order/i);
  });

  // The row that replaced "Booking, trip & service history" must not read as a
  // promise that a diver's dive history came across: an orders export holds
  // cancellations, and the whole safety of this feature is that a booking record
  // never gets counted as a dive (ADR 20260725-import-prior-visits).
  it("states past visits as booking records that never become trips", () => {
    const visits = row("pastVisits");
    expect(visits.what).toMatch(/^Past visits/);
    expect(visits.scope).toBe("included");
    expect(visits.detail).toMatch(/not a dive/i);
    expect(visits.detail).toMatch(/never appears on your schedule/i);
    expect(visits.detail).toMatch(/capacity/i);
  });

  it("states waiver/medical acceptance as trusted and marked imported", () => {
    const waiver = row("signedWaivers");
    expect(waiver.what).toBe("Signed waivers & medical clearance");
    expect(waiver.scope).toBe("included");
    expect(waiver.detail).toMatch(/trust/i);
    expect(waiver.detail).toMatch(/imported/i);
  });

  it("marks certifications and nitrox as coming across verified and flagged imported", () => {
    const cert = row("certificationCard");
    expect(cert.what).toBe("Certification record");
    expect(cert.scope).toBe("included");
    expect(cert.detail).toMatch(/verified/i);
    expect(cert.detail).toMatch(/imported/i);

    const nitrox = row("nitrox");
    expect(nitrox.what).toBe("Nitrox");
    expect(nitrox.scope).toBe("included");
    expect(nitrox.detail).toMatch(/verified/i);
  });

  it("says waiver/medical documents accept both images and PDFs", () => {
    const docs = row("waiverDocuments");
    expect(docs.what).toBe("Waiver / medical documents");
    expect(docs.detail).toMatch(/pdf/i);
  });

  it("brings specialty cards across, and says the dive waits on the staff confirm", () => {
    const specialty = row("specialtyCards");
    expect(specialty.what).toMatch(/^Specialty certifications/);
    expect(specialty.scope).toBe("included");
    expect(specialty.detail).toMatch(/verified/i);
    // The gate rule is the whole reason this row can be honest — it must be
    // stated on the row itself, not buried in a page's surrounding prose.
    expect(specialty.detail).toMatch(/confirm/i);
  });

  it("brings dive insurance across without implying it is a gate", () => {
    const insurance = row("diveInsurance");
    expect(insurance.what).toBe("Dive insurance (DAN)");
    expect(insurance.scope).toBe("included");
    expect(insurance.detail).toMatch(/never a gate/i);
  });

  it("never leaks internal vocabulary into a table three surfaces render verbatim", () => {
    // This table is rendered on both switching pages and in the import wizard.
    // An ADR id or a decision-register id here reaches a shop owner as a dead
    // end — say the thing the reference points at instead.
    for (const entry of IMPORT_HONESTY_TABLE) {
      const resolved = row(entry.id);
      expect(resolved.what, `${entry.id} — what`).not.toMatch(INTERNAL_VOCABULARY);
      expect(resolved.detail, `${entry.id} — detail`).not.toMatch(INTERNAL_VOCABULARY);
    }
  });
});
