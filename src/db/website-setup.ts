import { and, eq, sql } from "drizzle-orm";
import {
  readSetupLines,
  type SetupLine,
  setupLines,
  websiteReadingCall,
} from "@/lib/assists/website-setup";
import { allowedFetchHost } from "@/lib/claude/web-fetch";
import { nowDate } from "@/lib/clock";
import { type AssistOptions, assistsAvailable, runAssist } from "./assists";
import type { AppDb, AppTransaction } from "./client";
import { listActiveCourses } from "./courses";
import { setShopDeskHours } from "./desk-pings";
import { saveFormDraft } from "./form-drafts";
import { courses, shops, websiteSetupDrafts } from "./schema";

/**
 * **The website setup, against the database** (ADR 20261018-claude-assists;
 * the `setup` assist; the prompt is `src/lib/assists/website-setup.ts`).
 *
 * Reading a site stores its proposals as one row per shop
 * (`website_setup_drafts`), replacing the last reading. Accepting a line is
 * the owner's tap, and writes that one fact through a writer as narrow as the
 * line: the tagline alone, the phone alone, one course's price. A departure is
 * never created here: it becomes the board's own "Add a departure" draft,
 * because the board is the one place a trip is made. A policy is copy for the
 * owner to place, so it has no writer at all.
 */

export type WebsiteSetup = { host: string; lines: SetupLine[]; readAt: Date };

/**
 * The key a page posts back names its line *within one reading*: the
 * reading's time, then the line's stored key. Stored keys are positional
 * (`tagline-0`), so after the site is read again in another tab the same
 * stored key can name a different proposal; a tap carrying the old reading's
 * time is refused instead of writing words the owner never saw.
 */
function readingKey(readAt: Date, lineKey: string): string {
  return `${readAt.getTime()}.${lineKey}`;
}

function lineKeyIn(readAt: Date, key: string): string | null {
  const prefix = `${readAt.getTime()}.`;
  return key.startsWith(prefix) && key.length > prefix.length ? key.slice(prefix.length) : null;
}

export async function readWebsiteSetup(db: AppDb, shopId: string): Promise<WebsiteSetup | null> {
  const [row] = await db
    .select()
    .from(websiteSetupDrafts)
    .where(eq(websiteSetupDrafts.shopId, shopId))
    .limit(1);
  if (!row) return null;
  const lines = readSetupLines(row.lines).map((line) => ({
    ...line,
    key: readingKey(row.readAt, line.key),
  }));
  return { host: row.host, lines, readAt: row.readAt };
}

/**
 * The open line a tap names, with the draft row locked until the tap's
 * transaction ends: a second tap (the same line, or another line of the same
 * reading) waits here and then reads what the first one wrote. `null` when
 * there is no draft, the key is from another reading, or the line is not open.
 */
async function lockOpenLine(
  tx: AppTransaction,
  shopId: string,
  key: string,
): Promise<{ line: SetupLine; index: number } | null> {
  const [row] = await tx
    .select({ lines: websiteSetupDrafts.lines, readAt: websiteSetupDrafts.readAt })
    .from(websiteSetupDrafts)
    .where(eq(websiteSetupDrafts.shopId, shopId))
    .for("update")
    .limit(1);
  if (!row) return null;
  const lineKey = lineKeyIn(row.readAt, key);
  if (!lineKey) return null;
  const lines = readSetupLines(row.lines);
  const index = lines.findIndex((candidate) => candidate.key === lineKey);
  const line = lines[index];
  return line && line.status === "open" ? { line, index } : null;
}

export type ReadWebsiteOutcome = "read" | "nothing-found" | "bad-site" | "dark";

/** Reads the pasted site and stores what it proposes. Nothing is written to the shop. */
export async function readWebsiteForSetup(
  db: AppDb,
  input: { shopId: string; site: string; now?: Date } & AssistOptions,
): Promise<ReadWebsiteOutcome> {
  const host = allowedFetchHost(input.site);
  if (!host) return "bad-site";
  if (!(await assistsAvailable(db, input.shopId, input))) return "dark";
  const [shop] = await db
    .select({ currency: shops.currency })
    .from(shops)
    .where(eq(shops.id, input.shopId))
    .limit(1);
  if (!shop) return "dark";
  const catalog = (await listActiveCourses(db, input.shopId)).map((course) => ({
    id: course.id,
    name: course.title,
  }));
  const call = websiteReadingCall({ site: host, currency: shop.currency, courses: catalog });
  if (!call) return "bad-site";
  const value = await runAssist(db, { ...input, feature: "setup_website", call });
  const lines = value ? setupLines(value, catalog) : [];
  if (lines.length === 0) return "nothing-found";
  const readAt = input.now ?? nowDate();
  await db
    .insert(websiteSetupDrafts)
    .values({ shopId: input.shopId, host, lines, readAt })
    .onConflictDoUpdate({ target: websiteSetupDrafts.shopId, set: { host, lines, readAt } });
  return "read";
}

/** Sets one line's status in place, leaving every other line as it stands. */
async function markLine(
  tx: AppTransaction,
  shopId: string,
  index: number,
  status: "accepted" | "dismissed",
): Promise<void> {
  const path = `{${index},status}`;
  await tx
    .update(websiteSetupDrafts)
    .set({
      lines: sql`jsonb_set(${websiteSetupDrafts.lines}, ${path}::text[], to_jsonb(${status}::text))`,
    })
    .where(eq(websiteSetupDrafts.shopId, shopId));
}

export type AcceptSetupOutcome = "saved" | "departure-drafted" | "gone";

/**
 * Writes one accepted line through its writer and marks it accepted, in one
 * transaction holding the draft row. `gone` when there is no such open line
 * (accepted already, dismissed, a key from an earlier reading, or a key that
 * names nothing), or when its course is no longer the shop's; a `gone` writes
 * nothing.
 */
export async function acceptSetupLine(
  db: AppDb,
  input: { shopId: string; personId: string; key: string; now?: Date },
): Promise<AcceptSetupOutcome> {
  return db.transaction(async (tx) => {
    const open = await lockOpenLine(tx, input.shopId, input.key);
    if (!open) return "gone";
    const outcome = await writeLine(tx, input, open.line);
    if (outcome !== "gone") await markLine(tx, input.shopId, open.index, "accepted");
    return outcome;
  });
}

/** The one writer an accepted line goes through. */
async function writeLine(
  db: AppTransaction,
  input: { shopId: string; personId: string; now?: Date },
  line: SetupLine,
): Promise<AcceptSetupOutcome> {
  let outcome: AcceptSetupOutcome = "saved";
  switch (line.kind) {
    case "tagline":
      await db.update(shops).set({ tagline: line.text }).where(eq(shops.id, input.shopId));
      break;
    case "description":
      await db.update(shops).set({ description: line.text }).where(eq(shops.id, input.shopId));
      break;
    case "phone":
      await db.update(shops).set({ contactPhone: line.text }).where(eq(shops.id, input.shopId));
      break;
    case "deskHours":
      if (line.opensMinute === undefined || line.closesMinute === undefined) return "gone";
      await setShopDeskHours(db, input.shopId, {
        opensMinute: line.opensMinute,
        closesMinute: line.closesMinute,
      });
      break;
    case "coursePrice": {
      if (!line.courseId || line.priceCents === undefined) return "gone";
      const updated = await db
        .update(courses)
        .set({ priceCents: line.priceCents })
        .where(and(eq(courses.id, line.courseId), eq(courses.shopId, input.shopId)))
        .returning({ id: courses.id });
      if (updated.length === 0) return "gone";
      break;
    }
    case "departure": {
      const fields: [string, string][] = [
        ["title", line.text],
        ["startTime", line.startTime ?? ""],
      ];
      if (line.priceCents !== undefined) {
        fields.push(["priceDollars", (line.priceCents / 100).toFixed(2).replace(/\.00$/, "")]);
      }
      await saveFormDraft(db, {
        shopId: input.shopId,
        personId: input.personId,
        form: "add_departure",
        fields,
        now: input.now,
      });
      outcome = "departure-drafted";
      break;
    }
    case "policy":
      // Copy for the owner to place; nothing to write.
      return "gone";
  }
  return outcome;
}

/** Stops offering one line; false when the key names no open line of the current reading. */
export async function dismissSetupLine(db: AppDb, shopId: string, key: string): Promise<boolean> {
  return db.transaction(async (tx) => {
    const open = await lockOpenLine(tx, shopId, key);
    if (!open) return false;
    await markLine(tx, shopId, open.index, "dismissed");
    return true;
  });
}
