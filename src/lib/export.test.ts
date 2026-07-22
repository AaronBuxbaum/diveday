import { strFromU8, unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import type { Person, Shop, WaiverRecord } from "@/db/schema";
import {
  buildExportFiles,
  EXPORT_DATASETS,
  exportFilename,
  type ShopExportData,
  toCsv,
  zipExportBundle,
} from "./export";

const generatedAt = new Date("2026-07-22T12:00:00.000Z");

const shop: Shop = {
  id: "00000000-0000-0000-0000-00000000000a",
  name: "Reef & Wreck",
  slug: "reef-wreck",
  timezone: "America/New_York",
  jurisdiction: "rstc",
  contactEmail: "hello@reefwreck.example",
  contactPhone: null,
  packingList: ["Towel"],
  rentalItems: ["bcd"],
  rentalPricing: { setCents: 4500, perItemCents: {}, nitroxCents: null },
  dockCallMinutes: 30,
  isDemo: false,
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
};

const diver: Person & { roles: ("diver" | "owner")[] } = {
  id: "00000000-0000-0000-0000-00000000000b",
  shopId: shop.id,
  fullName: 'Nora "Deep" Quinn, PADI',
  email: "nora@example.com",
  phone: null,
  emergencyContactName: "Sam Quinn",
  emergencyContactPhone: "+1 305 555 0100",
  deletedAt: null,
  createdAt: new Date("2026-02-01T00:00:00.000Z"),
  roles: ["owner", "diver"],
};

const SECRET_TOKEN_HASH = "deadbeef-token-hash-must-never-export";

const waiverRecord: WaiverRecord = {
  id: "00000000-0000-0000-0000-00000000000c",
  shopId: shop.id,
  bookingId: "00000000-0000-0000-0000-00000000000d",
  personId: diver.id,
  templateId: "00000000-0000-0000-0000-00000000000e",
  templateTitle: "Standard release",
  templateVersion: 2,
  templateBody: "I, the undersigned,\nrelease the shop…",
  status: "completed",
  tokenHash: SECRET_TOKEN_HASH,
  expiresAt: new Date("2026-07-20T00:00:00.000Z"),
  startedAt: null,
  supersededAt: null,
  draftSignerName: "draft-name-should-not-export",
  draftAcknowledged: false,
  draftMedicalAnswers: null,
  signedName: "Nora Quinn",
  signatureMethod: "typed_consent",
  recordedByPersonId: null,
  consentedAt: new Date("2026-07-10T00:00:00.000Z"),
  signedAt: new Date("2026-07-10T00:00:00.000Z"),
  medicalAnswers: { questionnaireId: "rstc", questionnaireVersion: 1, responses: { q1: false } },
  medicalReviewRequired: false,
  completedAt: new Date("2026-07-10T00:00:01.000Z"),
  createdAt: new Date("2026-07-09T00:00:00.000Z"),
};

/** Smallest data set the bundle accepts: one shop, one diver, one signed waiver. */
const data: ShopExportData = {
  shop,
  people: [diver],
  certifications: [],
  specialtyCertifications: [],
  nitroxCertifications: [],
  waiverTemplates: [],
  waiverRecords: [waiverRecord],
  trips: [],
  tripDives: [],
  tripRequirements: [],
  tripSeries: [],
  tripAssignments: [],
  bookings: [],
  waitlistEntries: [],
  bookingPayments: [],
  orders: [],
  orderLineItems: [],
  rollCallEvents: [],
  rentalFitProfiles: [],
  diveSites: [],
  courses: [],
};

describe("toCsv", () => {
  it("escapes commas, quotes, and newlines per RFC 4180 and prefixes a BOM", () => {
    const csv = toCsv(["name", "note"], [['Nora "Deep" Quinn, PADI', "line one\nline two"]]);
    expect(csv).toBe('﻿name,note\r\n"Nora ""Deep"" Quinn, PADI","line one\nline two"\r\n');
  });

  it("renders dates as ISO 8601, null as empty, and structured cells as JSON", () => {
    const csv = toCsv(
      ["at", "gone", "flag", "tags"],
      [[new Date("2026-07-22T12:00:00.000Z"), null, true, ["a", "b"]]],
    );
    expect(csv).toBe('﻿at,gone,flag,tags\r\n2026-07-22T12:00:00.000Z,,true,"[""a"",""b""]"\r\n');
  });
});

describe("buildExportFiles", () => {
  const files = buildExportFiles(data, generatedAt);

  it("emits a README plus every dataset, even when a dataset is empty", () => {
    expect(Object.keys(files)).toEqual([
      "README.md",
      ...EXPORT_DATASETS.map((dataset) => dataset.filename),
    ]);
    // An empty dataset still ships its header row — schema, even with no rows.
    expect(files["bookings.csv"]).toContain("id,trip_id,person_id,status");
  });

  it("documents every file, its row count, and every column in the README", () => {
    const readme = files["README.md"];
    for (const entry of EXPORT_DATASETS) {
      expect(readme).toContain(`## ${entry.filename}`);
      for (const column of entry.columnDocs) expect(readme).toContain(`\`${column.header}\``);
    }
    expect(readme).toContain("(1 rows)"); // people.csv and waiver-records.csv
    expect(readme).toContain("Generated 2026-07-22T12:00:00.000Z");
    expect(readme).toContain("What is deliberately not included");
  });

  it("round-trips a hostile diver name through the people CSV", () => {
    expect(files["people.csv"]).toContain('"Nora ""Deep"" Quinn, PADI"');
  });

  it("exports the waiver evidence — signed text, signature, medical answers", () => {
    const csv = files["waiver-records.csv"];
    expect(csv).toContain("Nora Quinn");
    expect(csv).toContain("typed_consent");
    expect(csv).toContain('""questionnaireId"":""rstc""');
    expect(csv).toContain("release the shop");
  });

  it("never leaks signing-link secrets or draft state anywhere in the bundle", () => {
    const everything = Object.values(files).join("\n");
    expect(everything).not.toContain(SECRET_TOKEN_HASH);
    expect(everything).not.toContain("draft-name-should-not-export");
    expect(everything).not.toContain("token_hash");
  });

  it("uses unique headers within every dataset", () => {
    for (const entry of EXPORT_DATASETS) {
      const headers = entry.columnDocs.map((column) => column.header);
      expect(new Set(headers).size).toBe(headers.length);
    }
  });
});

describe("zipExportBundle", () => {
  it("zips exactly the built files, byte-for-byte", () => {
    const zipped = unzipSync(zipExportBundle(data, generatedAt));
    const files = buildExportFiles(data, generatedAt);
    expect(Object.keys(zipped).sort()).toEqual(Object.keys(files).sort());
    // The BOM survives zipping as raw bytes; TextDecoder strips it on read,
    // which is exactly what a spreadsheet does too.
    expect([...zipped["people.csv"].slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(strFromU8(zipped["people.csv"])).toBe(files["people.csv"].replace(/^﻿/, ""));
    expect(strFromU8(zipped["README.md"])).toBe(files["README.md"]);
  });
});

describe("exportFilename", () => {
  it("names the artifact by shop and date", () => {
    expect(exportFilename("reef-wreck", generatedAt)).toBe(
      "diveday-export-reef-wreck-2026-07-22.zip",
    );
  });
});
