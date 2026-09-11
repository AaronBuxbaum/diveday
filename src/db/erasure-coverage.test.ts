import { readFileSync } from "node:fs";
import { and, eq, getTableName, isNull } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { seededShopContext } from "@/test/db";
import { anonymizeDiver } from "./anonymize";
import type { AppDb } from "./client";
import * as schema from "./schema";
import { bookings, people, personRoles } from "./schema";

/**
 * The structural guard on the erasure path (`src/db/anonymize.ts`, ADR
 * 20260802-diver-data-erasure), in the shape of the one
 * `delete-path-coverage.test.ts` already puts over the two demo-reap orderings.
 *
 * Before this file, the only thing checking a promise made to a person who
 * asked to be forgotten was `anonymize.test.ts` — a set of per-table cases
 * somebody thought to write. A new table holding a diver's details was
 * invisible to it until a person thought of that table, and the record says how
 * that goes: `auth_provider_accounts` had no erasure delete from the day it was
 * added and was found by a `security-reviewer` pass on an unrelated change,
 * `auth_verifications` beside it by a second pass on the fix for the first, and
 * running this sweep by hand before writing it down found five more (issue
 * #1607). The asymmetry was the wrong way round: an incomplete demo reap
 * strands a shop behind a foreign-key violation, while an incomplete erasure
 * reports success.
 *
 * Every table a foreign key connects to `people` must therefore be **either**
 * written by the erasure **or** carry a written reason below for why it is
 * left standing. Adding a table without deciding fails, and the failure names
 * the table.
 *
 * ## Three limits, stated rather than papered over
 *
 * **1. It proves a table was *considered*, not that the statement is right.**
 * The write set is read from the source of `anonymize.ts`, not from a run. That
 * is a deliberate reversal of the delete-path guard's instrument, and it was
 * measured: running `anonymizeDiver` against a seeded diver through a recording
 * Proxy sees only ~30 of the tables the path writes, because the erasure's
 * conditional branches (`if (account)`, `if (owned)`) never fire for one
 * fixture. A guard built that way needs its unreachable tables keep-listed, and
 * a keep-list entry is exactly where a deleted statement hides. So the sweep is
 * static and complete, and `anonymize.test.ts` is where a *column* is asserted
 * to be gone. The last test below closes the gap the other way, by failing on a
 * write the static read cannot see.
 *
 * **2. "Written" is table-level, deliberately.** A table this file counts as
 * handled may still have a column nobody scrubbed — that is the per-table case
 * in `anonymize.test.ts`, and it is why both files exist. What this one
 * guarantees is that no table was *forgotten*.
 *
 * **3. It cannot *find* a table reached by text — so it asks about all of
 * them.** The closure follows declared foreign keys, so a table that names its
 * person as an address, an identifier or a polymorphic subject id is outside it
 * however many hops it runs, which is exactly how `auth_verifications` hid from
 * the delete-path guard for as long as it did. No pattern over column names
 * fixes that: this file tried one, and it missed both a bare `person_id` with
 * no foreign key and anything holding a person under a column named something
 * else. So `OUTSIDE_CLOSURE_REASONS` below is the **whole** complement — every
 * one of the 24 tables outside the closure carries a written reason, and a new
 * table lands in one list or the other on the day it is added. What is left
 * outside is judgement, not coverage: this guard makes someone answer for every
 * table, and a `security-reviewer` pass is what checks the answer.
 */

type ForeignKeyFacts = { target: string; columns: string[]; onDelete: string };
type TableFacts = { references: string[]; columns: string[]; foreignKeys: ForeignKeyFacts[] };

/**
 * Blank out line comments, block comments and string/template literals, keeping
 * the source's length so nothing else shifts. Crude on purpose: it only has to
 * stop a `.update(x)` inside prose or a quoted example from counting as a
 * write, and every real write site in this file is bare code.
 */
function stripCommentsAndStrings(source: string): string {
  let out = "";
  let mode: "code" | "line" | "block" | '"' | "'" | "`" = "code";
  for (let i = 0; i < source.length; i += 1) {
    const char = source[i] as string;
    const next = source[i + 1];
    if (mode === "code") {
      if (char === "/" && next === "/") {
        mode = "line";
        out += "  ";
        i += 1;
        continue;
      }
      if (char === "/" && next === "*") {
        mode = "block";
        out += "  ";
        i += 1;
        continue;
      }
      if (char === '"' || char === "'" || char === "`") {
        mode = char;
        out += " ";
        continue;
      }
      out += char;
      continue;
    }
    if (mode === "line") {
      if (char === "\n") mode = "code";
      out += char === "\n" ? char : " ";
      continue;
    }
    if (mode === "block") {
      if (char === "*" && next === "/") {
        mode = "code";
        out += "  ";
        i += 1;
        continue;
      }
      out += char === "\n" ? char : " ";
      continue;
    }
    // Inside a string literal.
    if (char === "\\") {
      out += "  ";
      i += 1;
      continue;
    }
    if (char === mode) mode = "code";
    out += char === "\n" ? char : " ";
  }
  return out;
}

function schemaTables(): Map<string, TableFacts> {
  const tables = new Map<string, TableFacts>();
  for (const value of Object.values(schema)) {
    // `getTableConfig` throws on everything in the schema that is not a table —
    // the enums and the views — which is how they are skipped.
    let config: ReturnType<typeof getTableConfig>;
    try {
      config = getTableConfig(value as Parameters<typeof getTableConfig>[0]);
    } catch {
      continue;
    }
    tables.set(getTableName(value as Parameters<typeof getTableName>[0]), {
      references: config.foreignKeys.map((key) => getTableName(key.reference().foreignTable)),
      columns: config.columns.map((column) => column.name),
      foreignKeys: config.foreignKeys.map((key) => ({
        target: getTableName(key.reference().foreignTable),
        columns: key.reference().columns.map((column) => column.name),
        onDelete: (key as unknown as { onDelete?: string }).onDelete ?? "no action",
      })),
    });
  }
  return tables;
}

/**
 * Every table a foreign key connects back to `people`, however many hops it
 * takes, run to a fixed point.
 *
 * Scope is the person, not the shop — an erasure follows one diver out of a
 * shop that carries on — so this starts at `people` rather than at the
 * `shop_id` carriers `delete-path-coverage.test.ts` starts from. It reaches 96
 * of the schema's tables.
 */
function personScopedTableNames(tables: Map<string, TableFacts>): string[] {
  const scoped = new Set<string>(["people"]);
  for (let grew = true; grew; ) {
    grew = false;
    for (const [name, table] of tables) {
      if (scoped.has(name)) continue;
      if (!table.references.some((target) => scoped.has(target))) continue;
      scoped.add(name);
      grew = true;
    }
  }
  return [...scoped];
}

/**
 * Every table `anonymizeDiver` writes, read from the source rather than from a
 * run — see limit 1 above.
 *
 * An identifier that does not resolve to a table in `./schema` is a failure
 * rather than a silent omission: a `tx.update(someLocalAlias)` would otherwise
 * shrink this set without shrinking the keep-list, and the guard would read
 * green over the table it stopped seeing.
 */
function erasureWriteSites(): { written: Set<string>; unresolved: string[] } {
  // Comments and string literals are stripped first. A write that is *commented
  // out* rather than deleted would otherwise still match, keeping its table in
  // this set and its absence out of the keep-list — which is the exact failure
  // the static instrument is here to prevent, so leaving it would have been a
  // guard that reads green over the statement it stopped running (issue #1607,
  // found by a `security-reviewer` pass on the first draft of this file).
  const source = stripCommentsAndStrings(readFileSync("src/db/anonymize.ts", "utf8"));
  const written = new Set<string>();
  const unresolved: string[] = [];
  for (const match of source.matchAll(/\.(?:update|delete)\(\s*([A-Za-z][A-Za-z0-9_]*)\s*\)/g)) {
    const identifier = match[1] as string;
    const value = (schema as Record<string, unknown>)[identifier];
    try {
      written.add(getTableName(value as Parameters<typeof getTableName>[0]));
    } catch {
      unresolved.push(identifier);
    }
  }
  return { written, unresolved };
}

/**
 * The tables `anonymizeDiver` **hard-deletes** from, in the order its source
 * deletes them. Order matters here and nowhere else in this file: a foreign key
 * into a deleted table is harmless if the referencing rows go first.
 */
function erasureHardDeleteOrder(): string[] {
  const source = stripCommentsAndStrings(readFileSync("src/db/anonymize.ts", "utf8"));
  const order: string[] = [];
  for (const match of source.matchAll(/\.delete\(\s*([A-Za-z][A-Za-z0-9_]*)\s*\)/g)) {
    const value = (schema as Record<string, unknown>)[match[1] as string];
    try {
      const name = getTableName(value as Parameters<typeof getTableName>[0]);
      if (!order.includes(name)) order.push(name);
    } catch {
      // Resolved and reported by `erasureWriteSites`; not this function's job.
    }
  }
  return order;
}

/**
 * Person-reachable tables the erasure deliberately leaves alone, and why.
 *
 * Each reason is a sentence a reviewer can disagree with rather than a category
 * label, because disagreeing with one is the only way a wrong answer here gets
 * found. Three arguments do most of the work and are worth stating once:
 *
 * - **A staff member is never erased** (`anonymizeDiver` refuses anyone holding
 *   a staff role), so a table whose only person column is the staffer who
 *   acted is not about the diver at all. Their name on the record is the shop's
 *   accountability trail, which the ADR keeps on purpose.
 * - **A pointer is not a disclosure.** A row that names a diver only by
 *   `person_id` says nothing once that person's row is erased, and the name
 *   joined at read now resolves to the anonymized one. Keeping the id is also
 *   what lets a replayed erasure reach the same rows.
 * - **An id-only row about a shop object** — which seat, which unit, which
 *   departure — is the shop's record of its own day.
 */
const ERASURE_KEEPS: Record<string, string> = {
  // --- the diver is named only by a pointer, or not at all -----------------
  buddy_pair_members:
    "which seats dived together, by id; the team's words live in `buddy_team_events`, which the erasure does redact",
  booking_checkout_bookings:
    "how one checkout's money split across the seats it paid for — four amounts and two ids",
  booking_arrival_events:
    "the arrival ledger for a seat: a status, a source and the staffer who recorded it, with no diver column and no free text",
  dive_package_entitlements:
    "ids, a consumption timestamp and an expiry — how many dives of a package are left, which is the shop’s own balance",
  shop_promo_redemptions:
    "that a code was redeemed on a checkout, and for how much; the diver is reached only through the checkout, which is redacted",
  trip_blowout_divers:
    "who was offered a re-book when a departure blew out, by id, plus whether the message left. The address it went to lives on the notification rows, which are redacted",
  trip_invitations:
    "that an invitation was sent for a seat, by id. Its risk is not disclosure but #1616, where the foreign key aborts the erasure transaction outright",
  trip_read_marks: "how far a staff member has read a trip’s desk feed",
  booking_referrals:
    "that one seat arrived from another seat's recap link — two booking ids and a timestamp, and nothing else. Both bookings carry their own erasure, so the diver either side of the link is erased where they are stored",
  trip_sightings:
    "what a crew tapped at a site: a species slug from DiveDay’s own catalogue, a count, and the site’s name as it stood. Its two person columns are the crew member who tapped and the one who undid it, pointers joined at read the way `trip_desk_events` is",
  person_shelf_tokens:
    "revoked rather than rewritten, and through `revokeShelfTokens` (./person-shelf-tokens) rather than here, so the static sweep above cannot see the write — `WRITTEN_VIA_HELPER` below is where that indirection is declared",
  trip_desk_events:
    "`subject_person_id` is a pointer by design and the name is joined at read, which resolves to the anonymized one after this runs",
  trip_help_requests:
    "that someone at a seat asked for help and when it was handled; a kind and a status, no words",
  payment_operation_intents:
    'a Stripe object id and a status word. Every writer passes a status or a fixed sentence — `session.status`, `result.status`, "booking already has an active checkout attempt" — so `error_message` never carries provider prose about a person',
  processor_erasure_obligations:
    "kept deliberately by ADR 20260803-processor-erasure-obligations: it names the erased person and whoever discharged the obligation, which is how an unfinished erasure stays visible",
  account_step_ups:
    "cleared by ON DELETE CASCADE from `user_accounts` and `account_sessions`, both of which the erasure deletes",
  push_subscriptions:
    "`person_id` is the staff member who opted a device in, and the erasure refuses anyone holding a staff role. This becomes a gap the day a diver-facing push subscription ships",
  trip_assignments: "which crew member works which departure — a staff roster row",

  // --- the shop's own objects, holding nobody ------------------------------
  trips:
    "a departure: its site, its times, its capacity and the arrival words a shop wrote for everyone who books it",
  trip_dives: "the dives inside a departure, by site and order",
  trip_requirements:
    "the gates a departure sets — a certification level, specialties, whether a waiver is needed",
  trip_schedule_days: "the day boundaries of a multi-day departure",
  trip_recap_photos:
    "the shop’s photographs of a departure, uploaded by a staff member and attached to the trip rather than to anyone on it. A photo *of* a diver is `recap_photos`, which the erasure deletes and queues for blob deletion",
  dive_sites: "a place, its briefing and its conditions",
  dive_site_creatures: "which catalogue species a site lists",
  dive_site_moments: "the shop’s own photographs of a site and their captions",
  dive_packages: "the shop’s price list of multi-dive packages",
  pre_departure_checklist_items: "the shop’s own checklist lines",
  gear_items: "the shop’s own units: a serial number, a size, a service note about the unit",
  shop_promo_codes: "a discount the shop published, its window and its ceiling",
  trip_last_minute_promos:
    "that a shop offered a deal on a departure and to how many people. The addresses it reached are on the recipient rows, which the erasure redacts",
  display_tokens: "a lobby screen's own capability and label, issued by a staff member",
  waiver_materiality_decisions:
    "an owner's ruling on whether a template change was material — a decision about the shop’s text, not about any signer",

  // --- the staffer who acted is the only person on the row -----------------
  closeout_leftover_decisions: "what a staff member decided to do with a leftover at close-out",
  crew_assignment_requests: "a crew member asking for a departure, and the answer",
  crew_availability_blocks: "a crew member’s own unavailable dates and their note about them",
  staff_shifts: "a staff member’s own hours and the note attached to them",
  executed_dives:
    "what the crew recorded about a dive that ran — depth, time, conditions, and why the plan changed",
  gear_service_events: "a technician's record of servicing a unit",
  pre_departure_check_events:
    "a crew member ticking a checklist line before a departure, and their note about the line",
  trip_stage_events: "the crew moving a departure through its stages",
  trip_change_events: "what changed on a departure, before and after, and who changed it",
  trip_blowouts: "who called a departure off, and when",
  review_moderation_events:
    "a moderator's action on a review and their reason for it. The review's own words are on `trip_reviews`, which the erasure redacts",
  marine_life_requests: "a staff member’s search for a species DiveDay does not carry",
  integration_oauth_states:
    "a single-use OAuth handshake bound to the staff member who started it and expiring in minutes",
  held_sends:
    "an eight-second undo window. Its `payload` carries ids only — never a name or an address, which the table's own docblock states and `src/lib/held-sends.ts` holds to — and nothing lingers, so nothing prunes it",
};

/**
 * The narrow complement: every table **outside** the person closure that
 * carries a contact-shaped column, and what the erasure does about it. This is
 * where the class that hid `auth_verifications` has to be decided rather than
 * merely admitted — see limit 3 above.
 */
/**
 * The complement, and it is **every** table outside the closure rather than a
 * sample of them.
 *
 * This started as a heuristic — the tables outside the closure carrying a
 * column named like an address — and that was too thin twice over. A table
 * declaring `person_id` **without** `.references(() => people.id)` fell out of
 * the closure *and* out of the pattern, so both tests stayed green over the
 * exact class limit 3 claims to narrow. And a table holding personal data under
 * some other column name entirely was never reachable by any pattern, which is
 * what a `sourcery-ai` review pointed out against the issue's own wording:
 * scope is every table, not the ones a regex thought to ask about.
 *
 * So: 121 tables, 96 in the closure, and each of the other 25 named here with
 * why an erasure is right to leave it. Almost all of them are the shop's own
 * settings or a provider's plumbing, which is exactly why this list is cheap to
 * keep and worth having — a new table lands here the day it is added, and the
 * only way past it is to write a sentence a reviewer can disagree with.
 */
const OUTSIDE_CLOSURE_REASONS: Record<string, string> = {
  // Reached by text rather than by a key, and swept that way. These two are the
  // worked examples of limit 3: no foreign key ties either to a person, and the
  // erasure finds them anyway because someone knew to look.
  auth_verifications:
    "better-auth's `verification` model: no foreign key at all, names its person as text in `identifier`. The erasure sweeps it by that column, because a pending row holds an address in clear and a live bearer token in `value`",
  notification_send_queue:
    "a queued send, matched on the address inside its sealed payload and on `booking_id`. The one un-normalized blob of personal data in the schema; a work queue, not evidence, so the rows are deleted rather than redacted",

  // The shop's own record of itself. A diver is not on any of these.
  shops:
    "the business: its name, its front-desk address and phone, its timezone and its own words. Erasing a diver does not touch the shop they dived with",
  shop_contact_email_confirmation_tokens:
    "the front-desk address's own proof of ownership (issue #1288) — the shop’s address, not a diver’s",
  shop_whatsapp_accounts:
    "the shop’s own WhatsApp sender: a number, a template and sealed credentials",
  shop_stripe_accounts: "the shop’s Connect account and what it is enabled for",
  shop_integrations: "a provider connection the shop made, and the sealed credentials behind it",
  shop_backup_destinations: "where the shop sends its own backups, and the sealed key to get there",
  shop_backup_deliveries:
    "whether one of those bundles arrived; a period key, a byte count and a status",
  shop_print_runs:
    "when the shop last printed each of its own sheets — a sheet name, the boat a boat card is for, and a timestamp. The paper pass records under the empty subject key precisely so which diver it printed for is not kept",
  boats: "the shop’s vessels",
  courses: "the shop’s course catalogue, copied from a template and then its own",
  waiver_templates:
    "the text a shop asks people to sign, versioned. The *signatures* are `waiver_records`, which the erasure strips and re-seals",
  trip_lenses: "the shop’s own word for a kind of day",
  season_events: "the shop’s own year — a mini-season, a derby, a nesting window",
  trip_series:
    "the cadence a repeating departure is generated from. Its instances are ordinary `trips` rows",
  trip_series_skips:
    "a date the shop took out of that cadence, so the nightly roll does not put it back",

  // DiveDay's own catalogue, shared by every shop and owned by none.
  global_dive_sites: "DiveDay’s catalogue of sites",
  global_dive_site_versions: "that catalogue's own history",

  // Plumbing: provider coordination and delivery ledgers, holding no person.
  notification_rate_limit_state: "provider coordination keyed by ceiling and period",
  stripe_webhook_events:
    "the platform's delivery ledger, pruned by retention; it carries no payload",
  media_deletion_attempts:
    "the blob-deletion ledger the erasure itself *writes to* — a URL, a kind and a retry count. Redacting it would be erasing the record of the erasure",
  integration_events:
    "the outbox a shop’s own integrations read. `entity_id` points at a row rather than copying it, and `payload` is built at delivery from the current record — which is the erased one by then",
  integration_deliveries: "whether one of those events reached the provider, and the error if not",
  integration_sync_records:
    "the map from a DiveDay row to the provider’s own object, which is what stops a second QuickBooks Customer being created for a diver already synced (issue #1015). Ids on both sides, no copied details",
};

/**
 * Tables the erasure writes through a helper module rather than in
 * `anonymize.ts` itself, which the static read above cannot see. Each is
 * named here so the recorder below has something to check against, and so the
 * indirection is visible rather than looking like a write nobody declared.
 */
const WRITTEN_VIA_HELPER: Record<string, string> = {
  media_deletion_attempts:
    "`queueMediaDeletion` (./media-deletions) — every blob the erasure retires goes through the existing durable ledger rather than a second mechanism invented here (ADR 20260723-media-validation-and-deletion)",
  person_shelf_tokens:
    '`revokeShelfTokens` (./person-shelf-tokens) — the shelf link is closed the way every other holder of it is closed, by the module that mints and verifies it, so one definition of "revoked" serves the erasure and the diver’s own "Forget this phone"',
  processor_erasure_obligations:
    "`recordProcessorErasureObligations` (./processor-erasure) — what Stripe still holds, written inside the transaction so a crash a millisecond later cannot lose it (ADR 20260803-processor-erasure-obligations)",
};

/**
 * Every column in the schema that stores a **handle to an object a payment
 * processor holds**, and what erasure owes against each.
 *
 * The processor half of erasure is a ledger (`processor_erasure_obligations`,
 * ADR 20260803-processor-erasure-obligations) fed from a list of source
 * columns someone thought to name — and that list was `orders` alone, while
 * `tips` and `booking_checkouts` carried session ids for a person the whole
 * time (issue #1621). That is the same failure mode as the keep-list above:
 * invisible until a person thinks of the table. So the census is exhaustive
 * rather than sampled, and a new column carrying a `cus_…`/`cs_…`/`in_…` fails
 * this file on the day it is added.
 *
 * **What it proves, and what it does not.** It proves every processor handle in
 * the schema was *decided about*: `person` means the object is held on behalf
 * of one diver and erasure owes an obligation for it, `shop` means it names the
 * shop's own Stripe furniture and no diver is behind it, `ledger` means the
 * column is the obligation record itself. It does **not** prove the erasure
 * actually raises a row for every `person` entry — that is asserted per case in
 * `anonymize.test.ts`, against the write rather than against a name.
 */
const PROCESSOR_OBJECT_COLUMNS: Record<
  string,
  { held: "person" | "shop" | "ledger"; why: string }
> = {
  "orders.stripe_customer_id": {
    held: "person",
    why: "a `cus_…` created for the diver being billed; deleted through `DELETE /v1/customers/{id}`",
  },
  "orders.stripe_invoice_id": {
    held: "person",
    why: "a finalized invoice carrying a snapshot of the diver's name and email that no API rewrites; manual, discharged by a human attesting to Stripe's data-deletion request",
  },
  "booking_checkouts.stripe_session_id": {
    held: "person",
    why: "a Checkout Session holding `customer_email` as given and `customer_details` after completion; Stripe can expire a session but never rewrites either, so it is the same manual shape as an invoice snapshot",
  },
  "booking_checkouts.stripe_customer_id": {
    held: "person",
    why: 'the `cus_…` Stripe minted for that session, recorded so an obligation can name a customer object that actually exists (issue #1621). Null when `customer_creation: "if_required"` created none, and then nothing is owed',
  },
  "tips.stripe_session_id": {
    held: "person",
    why: "the tipping diver's own Checkout Session — same shape and same manual discharge as a booking checkout's",
  },
  "tips.stripe_customer_id": {
    held: "person",
    why: "the `cus_…` that tip's session created, on the same `if_required` rule as booking_checkouts",
  },
  "orders.stripe_account_id": {
    held: "shop",
    why: "the connected account the order lives on — the shop's, and the scope an obligation is discharged against, never a person's object",
  },
  "booking_checkouts.stripe_account_id": { held: "shop", why: "as orders.stripe_account_id" },
  "tips.stripe_account_id": { held: "shop", why: "as orders.stripe_account_id" },
  "shop_stripe_accounts.stripe_account_id": {
    held: "shop",
    why: "the shop's own Connect account. Disconnecting it is a shop decision, not an erasure",
  },
  "shop_promo_codes.stripe_coupon_id": {
    held: "shop",
    why: "a discount the shop published; no diver is behind the object",
  },
  "shop_promo_codes.stripe_promotion_code_id": { held: "shop", why: "as stripe_coupon_id above" },
  "trip_last_minute_promos.stripe_coupon_id": {
    held: "shop",
    why: "a trip-scoped deal the shop published; the redemption that ties a person to it lives locally and is erased locally",
  },
  "trip_last_minute_promos.stripe_promotion_code_id": {
    held: "shop",
    why: "as stripe_coupon_id above",
  },
  "payment_operation_intents.stripe_object_id": {
    held: "shop",
    why: "the idempotency ledger's record of which object an attempt produced — a pointer to an object already censused under the table that owns it, never a second one",
  },
  "imported_payment_history.stripe_reference": {
    held: "shop",
    why: "a free-text reference a shop typed or imported from its previous system. It is the shop's own bookkeeping note, scrubbed with the rest of the row rather than chased at a processor",
  },
  "processor_erasure_obligations.stripe_account_id": {
    held: "ledger",
    why: "the obligation row's own scope column — the ledger, not a source for it",
  },
};

/** `table.column` for every column that names an object a processor holds. */
function processorObjectColumns(tables: Map<string, TableFacts>): string[] {
  const found: string[] = [];
  for (const [name, facts] of tables) {
    for (const column of facts.columns) {
      if (column.startsWith("stripe_")) found.push(`${name}.${column}`);
    }
  }
  return found.sort();
}

/**
 * Run `work` against a db that records every table written through it — inside
 * the transaction as well as outside, since the erasure does all of its work on
 * a `tx`. The writes still execute, so a path that would fail still fails.
 */
async function recordWrittenTables(
  db: AppDb,
  work: (recorder: AppDb) => Promise<unknown>,
): Promise<Set<string>> {
  const written = new Set<string>();
  const wrap = <T extends object>(target: T): T =>
    new Proxy(target, {
      get(inner, property, receiver) {
        // `insert` is watched too, and that is not symmetry for its own sake:
        // both helpers in `WRITTEN_VIA_HELPER` write by insert, so a recorder
        // watching only updates and deletes could never observe either one and
        // the claim below would have been vacuous. A future helper that inserts
        // a row carrying the diver's data would have been invisible to the
        // static read *and* to this test (issue #1607, `security-reviewer`).
        if (property === "update" || property === "delete" || property === "insert") {
          return (table: Parameters<AppDb["delete"]>[0]) => {
            written.add(getTableName(table));
            return (inner as unknown as AppDb)[property as "update" | "delete" | "insert"](
              table as never,
            ) as unknown;
          };
        }
        if (property === "transaction") {
          return (callback: (tx: unknown) => Promise<unknown>, ...rest: unknown[]) =>
            (inner as unknown as AppDb).transaction(
              ((tx: object) => callback(wrap(tx))) as never,
              ...(rest as []),
            );
        }
        const value = Reflect.get(inner, property, receiver);
        return typeof value === "function" ? value.bind(inner) : value;
      },
    });
  await work(wrap(db) as AppDb);
  return written;
}

describe("erasure coverage", () => {
  const tables = schemaTables();

  it("enumerates enough tables to be worth asserting on", () => {
    expect(tables.size).toBeGreaterThan(100);
    expect(personScopedTableNames(tables).length).toBeGreaterThan(80);
  });

  it("resolves every write site in anonymize.ts to a table", () => {
    const { written, unresolved } = erasureWriteSites();
    expect(unresolved).toEqual([]);
    expect(written.size).toBeGreaterThan(30);
  });

  it("writes or deliberately keeps every table a foreign key connects to a diver", () => {
    const { written } = erasureWriteSites();
    const undecided = personScopedTableNames(tables)
      .filter((name) => !written.has(name) && !(name in ERASURE_KEEPS))
      .sort();
    expect(undecided).toEqual([]);
  });

  it("has no keep-reason for a table the erasure does write", () => {
    const { written } = erasureWriteSites();
    expect(
      Object.keys(ERASURE_KEEPS)
        .filter((name) => written.has(name))
        .sort(),
    ).toEqual([]);
  });

  /**
   * The static sweep's blind spot, closed from the other side: a real erasure
   * is run through a recorder, and every table it actually wrote must be one
   * this file already knows about. A write that moved into a helper module
   * fails here until it is named in `WRITTEN_VIA_HELPER`, so the indirection
   * cannot quietly take a table out of the sweep's sight.
   *
   * It deliberately asserts nothing about what the run did *not* reach: one
   * fixture never fires every branch, which is why the sweep above is static.
   */
  it("writes no table the sweep above cannot see", async () => {
    const { db, shop } = await seededShopContext({ history: true });
    const [owner] = await db
      .select({ id: people.id })
      .from(people)
      .innerJoin(personRoles, eq(personRoles.personId, people.id))
      .where(and(eq(people.shopId, shop.id), eq(personRoles.role, "owner")))
      .limit(1);
    if (!owner) throw new Error("expected the seeded owner");
    // A seeded diver who actually holds a seat, not a bare `people` row. The
    // erasure's big conditional (`if (owned)`) covers most of the file, so a
    // diver with no booking exercises the unconditional statements only and the
    // recording below would be nearly vacuous.
    const [diver] = await db
      .select({ id: people.id })
      .from(people)
      .innerJoin(bookings, eq(bookings.personId, people.id))
      .innerJoin(personRoles, eq(personRoles.personId, people.id))
      .where(
        and(
          eq(people.shopId, shop.id),
          eq(personRoles.role, "diver"),
          isNull(people.deletedAt),
          isNull(people.anonymizedAt),
        ),
      )
      .orderBy(people.id)
      .limit(1);
    if (!diver) throw new Error("expected a seeded diver holding a booking");

    const recorded = await recordWrittenTables(db, (recorder) =>
      anonymizeDiver(recorder, {
        shopId: shop.id,
        personId: diver.id,
        actorPersonId: owner.id,
      }),
    );
    // The `owned` branch alone is worth more than this; the bound is a floor
    // that catches the recorder silently seeing nothing, not a target.
    expect(recorded.size).toBeGreaterThan(25);

    const { written } = erasureWriteSites();
    const unaccounted = [...recorded]
      .filter((name) => !written.has(name) && !(name in WRITTEN_VIA_HELPER))
      .sort();
    expect(unaccounted).toEqual([]);
  });

  /**
   * **A foreign key pointing *at* a table the erasure deletes from can abort the
   * whole erasure**, and nothing guarded that until issue #1616.
   *
   * The scrub is one transaction. A referencing row makes a `delete` raise
   * 23503, and the rollback takes every other redaction with it — so the
   * failure is not a partial erasure, it is none, and neither `anonymizeDiver`
   * nor `eraseDiverAction` catches it. That is what
   * `trip_invitations.waitlist_entry_id` would have done: it referenced
   * `trip_waitlist_entries` with no `onDelete`, and only the fact that no row
   * ever populated it kept the erasure working.
   *
   * Dropping that column fixed the instance. This closes the class, which is
   * the half the row-level test below cannot reach: after the column is gone,
   * no arrangement of rows can construct the hazard, so only the schema can be
   * asked about it. A `security-reviewer` pass made exactly that point.
   *
   * A key is safe three ways, and the third is the interesting one:
   *
   *   1. it declares `onDelete: "cascade"` or `"set null"`, so Postgres clears
   *      the referencing rows itself;
   *   2. its target is not a table the erasure hard-deletes from at all;
   *   3. **its own table is hard-deleted earlier in the same scrub.** That is
   *      how `last_minute_list_unsubscribe_tokens` survives — the tokens go two
   *      statements before the entries they point at, an invariant that lived
   *      nowhere but the adjacency of those two lines until this assertion.
   *
   * The limit, stated rather than left implied: source order is not execution
   * order for a delete inside a conditional branch. This proves the statements
   * are written in a safe sequence, and `anonymize.test.ts` running the real
   * path against a real database is what proves they execute in one.
   */
  it("has no foreign key that could abort the erasure transaction", () => {
    const order = erasureHardDeleteOrder();
    expect(order.length).toBeGreaterThan(10);
    const deletedAt = new Map(order.map((name, index) => [name, index]));

    const hazards: string[] = [];
    for (const [name, facts] of tables) {
      for (const key of facts.foreignKeys) {
        const targetDeletedAt = deletedAt.get(key.target);
        if (targetDeletedAt === undefined) continue;
        if (key.onDelete === "cascade" || key.onDelete === "set null") continue;
        const ownDeletedAt = deletedAt.get(name);
        if (ownDeletedAt !== undefined && ownDeletedAt < targetDeletedAt) continue;
        hazards.push(`${name}.${key.columns.join(",")} -> ${key.target} (${key.onDelete})`);
      }
    }
    expect(hazards.sort()).toEqual([]);
  });

  it("decides every table outside the closure, not only the ones a pattern asks about", () => {
    const scoped = new Set(personScopedTableNames(tables));
    expect([...tables.keys()].filter((name) => !scoped.has(name)).sort()).toEqual(
      Object.keys(OUTSIDE_CLOSURE_REASONS).sort(),
    );
  });

  /**
   * Issue #1621: the ledger's source list was `orders` alone while two other
   * tables held a Checkout Session for a person. Nothing failed — an erasure
   * simply reported success over objects Stripe still held, which is a promise
   * broken rather than a bug, and exactly the asymmetry this file exists for.
   */
  it("decides every processor handle in the schema, not only the ones somebody remembered", () => {
    expect(processorObjectColumns(tables)).toEqual(Object.keys(PROCESSOR_OBJECT_COLUMNS).sort());
  });
});
