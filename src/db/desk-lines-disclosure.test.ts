import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { and, eq, ne } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { DESK_ONLY_CODES, type DeskOnlyCode } from "@/lib/activity";
import { fileScopedShopContext } from "@/test/db";
import { loadDiverExportBundleInput, loadShopExportBundleInput } from "./export";
import {
  listTripActivity,
  pagedDiverActivity,
  recordActivityRow,
  recordDeskLine,
} from "./operations";
import { activityEvents, bookings, people, personRoles, trips } from "./schema";
import { listTripChangeEvents } from "./trip-change-events";
import { liveTrip } from "./trips-live";

/**
 * **The #1202 disclosure boundary, after the fold** (issue #2701).
 *
 * The crew's desk lines used to live in a table of their own so that no query
 * could serve a diver a staff fact. They now sit in `activity_events` beside
 * the trail, told apart by code and by `audience`. These tests write every
 * desk-only code and the desk-flagged trail codes about one seated diver, then
 * read every surface that faces that diver or leaves the shop, and prove none
 * of them carries a desk line — and that no diver-facing route module can
 * reach the readers that do.
 */

const ctx = fileScopedShopContext();

async function deskLinesAboutOneDiver() {
  const { db, shop } = ctx;
  const [desk] = await db
    .select({ id: people.id })
    .from(people)
    .innerJoin(personRoles, eq(personRoles.personId, people.id))
    .where(and(eq(people.shopId, shop.id), eq(personRoles.role, "instructor")))
    .limit(1);
  const [seat] = await db
    .select({ id: bookings.id, personId: bookings.personId, tripId: bookings.tripId })
    .from(bookings)
    .innerJoin(trips, eq(trips.id, bookings.tripId))
    .where(
      and(
        eq(bookings.shopId, shop.id),
        eq(trips.status, "scheduled"),
        ne(bookings.status, "cancelled"),
        liveTrip(),
      ),
    )
    .limit(1);
  if (!desk || !seat) throw new Error("fixture needs a staffer and a seated diver");
  const line = { shopId: shop.id, tripId: seat.tripId, bookingId: seat.id };
  const ids: string[] = [];
  for (const code of DESK_ONLY_CODES) {
    await recordDeskLine(db, {
      ...line,
      code: code as DeskOnlyCode,
      subjectPersonId: seat.personId,
      actorPersonId: desk.id,
    });
  }
  // One with no actor at all, as a diver's own ask on their link writes it.
  await recordDeskLine(db, { ...line, code: "desk_help_request", subjectPersonId: seat.personId });
  const flagged = await recordActivityRow(db, {
    ...line,
    code: "counter_check_in",
    actorPersonId: desk.id,
    subjectPersonId: seat.personId,
    params: { diver: "Diver" },
  });
  const deskRows = await db
    .select({ id: activityEvents.id })
    .from(activityEvents)
    .where(and(eq(activityEvents.shopId, shop.id), eq(activityEvents.tripId, seat.tripId)));
  ids.push(...deskRows.map((row) => row.id));
  return { db, shop, seat, desk, flaggedId: flagged?.id, ids };
}

/** Every cell of every file in a bundle, as text. */
function cells(bundle: { tables: { file: string; rows: unknown[][] }[] }): string[] {
  return bundle.tables.flatMap((table) => table.rows.flat().map((cell) => String(cell)));
}

describe("desk lines never reach a diver-facing read", () => {
  it("stores every desk line for staff, whatever the writer", async () => {
    const { db, shop, seat } = await deskLinesAboutOneDiver();
    const rows = await db
      .select({ code: activityEvents.code, audience: activityEvents.audience })
      .from(activityEvents)
      .where(and(eq(activityEvents.shopId, shop.id), eq(activityEvents.tripId, seat.tripId)));
    expect(rows.length).toBeGreaterThan(DESK_ONLY_CODES.length);
    expect(rows.filter((row) => row.audience !== "staff")).toEqual([]);
  });

  it("keeps them off the diver's own change ledger", async () => {
    const { db, shop, seat } = await deskLinesAboutOneDiver();
    const ledger = await listTripChangeEvents(db, shop.id, seat.tripId);
    const kinds = ledger.map((event) => event.kind as string);
    for (const code of DESK_ONLY_CODES) {
      expect(kinds).not.toContain(code);
      expect(kinds).not.toContain(code.replace(/^desk_/, ""));
    }
  });

  it("keeps them out of the diver's own export, by id and by code", async () => {
    const { db, shop, seat, ids } = await deskLinesAboutOneDiver();
    const bundle = await loadDiverExportBundleInput(db, shop.id, seat.personId);
    if (!bundle) throw new Error("the diver's export is missing");
    expect(bundle.tables.map((table) => table.file)).not.toContain("activity_events.csv");
    const text = cells(bundle);
    for (const id of ids) expect(text).not.toContain(id);
    for (const code of DESK_ONLY_CODES) expect(text).not.toContain(code);
  });

  it("keeps desk-only lines out of the shop's export and every staff trail", async () => {
    const { db, shop, seat, flaggedId } = await deskLinesAboutOneDiver();
    const bundle = await loadShopExportBundleInput(db, shop.id);
    if (!bundle) throw new Error("the shop's export is missing");
    const activity = bundle.tables.find((table) => table.file === "activity_events.csv");
    const codeAt = activity?.header.indexOf("code") ?? -1;
    const exported = (activity?.rows ?? []).map((row) => String(row[codeAt]));
    for (const code of DESK_ONLY_CODES) expect(exported).not.toContain(code);
    // The flagged trail line is the shop's own history and stays in its file.
    expect((activity?.rows ?? []).map((row) => row[0])).toContain(flaggedId);

    const trail = await listTripActivity(db, shop.id, seat.tripId);
    expect(trail.map((row) => row.code).filter((code) => code.startsWith("desk_"))).toEqual([]);
    const record = await pagedDiverActivity(db, shop.id, seat.personId, { pageSize: 500 });
    expect(record.rows.map((row) => row.code).filter((code) => code.startsWith("desk_"))).toEqual(
      [],
    );
  });
});

/**
 * **No diver-facing route reaches a staff reader of the shared table.** A
 * diver page (`src/app/s/**`) or a bearer-token page (`src/app/(token)/**`)
 * that imported the catch-up's readers, the staff trail's, or the table
 * itself would be one edit away from printing a desk line to a diver.
 */
describe("diver-facing route modules", () => {
  const STAFF_READERS = [
    "@/db/trip-read-marks",
    "../features/today-catch-up/store.ts",
    "@/db/shop-activity",
    "listTripActivity",
    "pagedDiverActivity",
    "activityEvents",
  ];

  function filesUnder(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) return filesUnder(path);
      return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
    });
  }

  it("import no staff reader of activity_events", () => {
    const root = join(process.cwd(), "src", "app");
    const files = [...filesUnder(join(root, "s")), ...filesUnder(join(root, "(token)"))];
    expect(files.length).toBeGreaterThan(0);
    const offenders = files.flatMap((file) => {
      const source = readFileSync(file, "utf8");
      return STAFF_READERS.filter((reader) => source.includes(reader)).map(
        (reader) => `${file}: ${reader}`,
      );
    });
    expect(offenders).toEqual([]);
  });
});
