import { and, eq } from "drizzle-orm";
import {
  readSetupLines,
  type SetupLine,
  setupLines,
  websiteReadingCall,
} from "@/lib/assists/website-setup";
import { allowedFetchHost } from "@/lib/claude/web-fetch";
import { nowDate } from "@/lib/clock";
import { type AssistOptions, assistsAvailable, runAssist } from "./assists";
import type { AppDb } from "./client";
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

export async function readWebsiteSetup(db: AppDb, shopId: string): Promise<WebsiteSetup | null> {
  const [row] = await db
    .select()
    .from(websiteSetupDrafts)
    .where(eq(websiteSetupDrafts.shopId, shopId))
    .limit(1);
  return row ? { host: row.host, lines: readSetupLines(row.lines), readAt: row.readAt } : null;
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

async function markLine(
  db: AppDb,
  shopId: string,
  setup: WebsiteSetup,
  key: string,
  status: "accepted" | "dismissed",
): Promise<void> {
  const lines = setup.lines.map((line) => (line.key === key ? { ...line, status } : line));
  await db.update(websiteSetupDrafts).set({ lines }).where(eq(websiteSetupDrafts.shopId, shopId));
}

export type AcceptSetupOutcome = "saved" | "departure-drafted" | "gone";

/**
 * Writes one accepted line through its writer and marks it accepted. `gone`
 * when there is no such open line (accepted already, dismissed, read over,
 * or a key that names nothing), or when its course is no longer the shop's.
 */
export async function acceptSetupLine(
  db: AppDb,
  input: { shopId: string; personId: string; key: string; now?: Date },
): Promise<AcceptSetupOutcome> {
  const setup = await readWebsiteSetup(db, input.shopId);
  const line = setup?.lines.find((candidate) => candidate.key === input.key);
  if (!setup || !line || line.status !== "open") return "gone";

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
  await markLine(db, input.shopId, setup, line.key, "accepted");
  return outcome;
}

/** Stops offering one line. */
export async function dismissSetupLine(db: AppDb, shopId: string, key: string): Promise<boolean> {
  const setup = await readWebsiteSetup(db, shopId);
  const line = setup?.lines.find((candidate) => candidate.key === key);
  if (!setup || !line || line.status !== "open") return false;
  await markLine(db, shopId, setup, key, "dismissed");
  return true;
}
