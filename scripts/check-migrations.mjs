#!/usr/bin/env node
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

import { migrationPathsAt, resolveBaseCommit } from "./previous-release-migrations.mjs";

/**
 * One invariant: **a migration may not break the deployment that is still live
 * while the new one builds.**
 *
 * `scripts/vercel-build.mjs` runs `pnpm db:migrate` *inside* the Vercel
 * production build. There is no approval step between "schema changed" and
 * "code deployed", no down migrations, and no staging environment — so a
 * contracting statement lands against the previous release's running code, and
 * the only way back is a forward migration or a database restore
 * (docs/engineering/deploy-and-migrations-runbook.md). The `real-postgres` CI
 * job (ADR 20260806-real-postgres-ci-job) proves such a migration *applies*
 * cleanly on top of the previous release's schema; applying cleanly is exactly
 * what a `DROP COLUMN` does. Nothing was asking whether it *should*.
 *
 * This asks. It reads the SQL of every migration newer than the previous
 * release and refuses the statements the runbook's expand/contract rule already
 * forbids, unless the migration itself carries an acknowledgement naming the
 * statement and why it is safe.
 *
 * ## Honest limits
 *
 * This is a **regex-level** guard — cooperative, not a boundary. It masks
 * comments, string literals, and quoted identifiers before matching (so a
 * `DROP TABLE` inside a `RAISE EXCEPTION` message is not a false positive, and
 * a column named `"drop column"` is not a false negative), then matches
 * keyword shapes on the result. It does not parse SQL. Anyone determined to
 * smuggle DDL past it — `EXECUTE format(...)` inside a `DO` block, a
 * dynamically assembled statement — can. The point is that nobody arrives at
 * that by accident, which is the failure this guard exists to catch.
 *
 * Known gaps, deliberately not covered, each because the rule would fire on the
 * common safe case and a guard that cries wolf teaches people to wave it
 * through: `ADD CONSTRAINT ... FOREIGN KEY` and `ADD CONSTRAINT ... UNIQUE`
 * (drizzle emits one per new table), `DROP INDEX` (it cannot break the
 * previously-live code — only its latency), and `DROP VIEW`/`DROP FUNCTION`/
 * `DROP TRIGGER` (this schema has none).
 */

const ROOT = process.cwd();
const MIGRATIONS_DIR = "drizzle";

/**
 * Migrations at or before this folder predate the guard and are not audited.
 *
 * The folder names are timestamp-prefixed, so "predates" is a lexicographic
 * comparison and needs no list of names. This is the same ratchet shape as
 * `scripts/copy-baseline.json` and friends, with one difference worth stating:
 * it never needs bumping. Everything after this line is audited *forever*, not
 * once — a destructive migration that legitimately merges carries its
 * acknowledgement in the file, so it keeps passing on its own evidence.
 */
const GRANDFATHERED_THROUGH = "20260805033500_remove-course-paths-add-inquiry-preferred-date";

/** The marker's sentinel. Namespaced and colon-joined so no prose contains it. */
const ACKNOWLEDGEMENT = "diveday:allow-destructive";

/** How much reason a marker must carry before it counts as one. */
const MINIMUM_REASON_LENGTH = 20;

/**
 * An identifier as it survives masking: a quoted run of `I`s, or a bare word.
 * Written against the uppercased, whitespace-collapsed statement.
 */
const IDENT = '(?:"[^"]*"|[A-Z_][A-Z0-9_$]*)';

/**
 * The refusals. Every one of them is a line from the runbook's "never in a
 * single deploy (contract)" list, or the data-loss statements that list assumes
 * nobody would write into a migration by hand.
 *
 * `note` is what the failure prints: not "this is forbidden" but *which live
 * code it breaks*, because that is the sentence that tells an author whether
 * they need to split the change or acknowledge it.
 */
export const rules = [
  {
    id: "drop-table",
    note: "the live deployment still reads this table",
    pattern: /\bDROP\s+TABLE\b/,
  },
  {
    id: "drop-schema",
    note: "takes every object in the schema with it",
    pattern: /\bDROP\s+SCHEMA\b/,
  },
  {
    id: "drop-type",
    note: "columns of this type, and the live code that writes them, break at once",
    pattern: /\bDROP\s+TYPE\b/,
  },
  {
    id: "drop-extension",
    note: "indexes and operators built on the extension go with it",
    pattern: /\bDROP\s+EXTENSION\b/,
  },
  {
    id: "truncate",
    note: "deletes every row, and no forward migration can put them back",
    pattern: /\bTRUNCATE\b/,
  },
  {
    // A `DELETE FROM t;` is a `TRUNCATE` spelled differently, and refusing one
    // while allowing the other would be a guard with a hole in the shape of a
    // keyword. A `DELETE ... WHERE ...` is a normal bounded cleanup and passes.
    id: "delete-without-where",
    note: "an unbounded DELETE empties the table; add a WHERE clause",
    matches: (statement) => /\bDELETE\s+FROM\b/.test(statement) && !/\bWHERE\b/.test(statement),
  },
  {
    id: "drop-column",
    note: "the live deployment still selects and writes this column",
    pattern: /\bALTER\s+TABLE\b[\s\S]*\bDROP\s+COLUMN\b/,
  },
  {
    // Dropping a constraint is destructive, and the call is deliberate. It is
    // not merely "removing a check": `ON CONFLICT (cols)` requires a matching
    // unique constraint or index and *errors outright* without one, so live
    // upserts break the instant it lands; a foreign key's `ON DELETE` behaviour
    // is application semantics the code relies on; and rows written while the
    // constraint is gone can make re-adding it impossible, so it is not the
    // cheaply-reversible change it looks like. Replacing a constraint in place
    // is the legitimate case, and that is what the acknowledgement is for.
    id: "drop-constraint",
    note: "live upserts and cascade behaviour depend on it, and re-adding it can fail on rows written meanwhile",
    pattern: /\bALTER\s+TABLE\b[\s\S]*\bDROP\s+CONSTRAINT\b/,
  },
  {
    id: "rename-table",
    note: "a rename is a drop and an add at the same instant — split it across releases",
    pattern: /\bALTER\s+TABLE\b[\s\S]*\bRENAME\s+TO\b/,
  },
  {
    id: "rename-column",
    note: "a rename is a drop and an add at the same instant — split it across releases",
    pattern: new RegExp(
      String.raw`\bALTER\s+TABLE\b[\s\S]*\bRENAME\s+(?:COLUMN\s+)?${IDENT}\s+TO\b`,
    ),
  },
  {
    id: "alter-column-type",
    note: "a non-binary-coercible type change rewrites the table and breaks the live deployment's reads",
    pattern: new RegExp(
      String.raw`\bALTER\s+TABLE\b[\s\S]*\bALTER\s+(?:COLUMN\s+)?${IDENT}\s+(?:SET\s+DATA\s+)?TYPE\b`,
    ),
  },
  {
    id: "set-not-null",
    note: "existing rows may violate it, and the live deployment still writes NULL",
    pattern: new RegExp(
      String.raw`\bALTER\s+TABLE\b[\s\S]*\bALTER\s+(?:COLUMN\s+)?${IDENT}\s+SET\s+NOT\s+NULL\b`,
    ),
  },
  {
    id: "drop-default",
    note: "inserts from the live deployment that omit the column start failing",
    pattern: new RegExp(
      String.raw`\bALTER\s+TABLE\b[\s\S]*\bALTER\s+(?:COLUMN\s+)?${IDENT}\s+DROP\s+DEFAULT\b`,
    ),
  },
  {
    // `ALTER TYPE ... RENAME` in every form (the type, a value, an attribute).
    // Its additive sibling `ALTER TYPE ... ADD VALUE` is safe and must pass.
    id: "rename-type",
    note: "the live deployment reads and writes the old name",
    pattern: /\bALTER\s+TYPE\b[\s\S]*\bRENAME\b/,
  },
];

const ruleIds = new Set(rules.map((rule) => rule.id));

function ruleMatches(rule, statement) {
  return rule.matches ? rule.matches(statement) : rule.pattern.test(statement);
}

/**
 * One pass over the file, producing everything the rest of this script reads.
 * Both output strings are the **same length** as the source and keep its line
 * breaks, so an offset into either still points at the same place in the
 * original — which is what makes the reported line numbers real.
 *
 * - `masked` is what the rules match: comments and string-literal contents
 *   blanked, and quoted-identifier contents replaced by a run of `i`. Blanking
 *   identifiers instead would make `RENAME "c" TO "d"` (a column rename)
 *   indistinguishable from `RENAME TO "b"` (a table rename); keeping them
 *   verbatim would let a column literally named `"drop column"` spoof a
 *   keyword. A fixed filler does neither.
 * - `code` is what an acknowledgement's target matches and what the failure
 *   quotes: the same blanking, but identifiers left readable. A marker must
 *   name something in the *statement*, never something in a comment sitting
 *   above it — the two differ by exactly this string.
 * - `lineComments` holds the offset of every `--` that genuinely opened a line
 *   comment. A marker is only a marker on one of those, which is what stops a
 *   `--` sitting inside a multi-line string literal from acting as one.
 * - `terminators` holds every `;` outside a comment or literal.
 *
 * A dollar-quoted body (`DO $$ ... $$`) is treated as code, not as a literal:
 * the DDL this guard exists to see can legitimately live inside one, and its
 * inner `;`s separate real statements. The price is that a `$$...$$` used as a
 * *string value* containing the word DROP would be a false positive. Nothing in
 * `drizzle/` writes one, and a false positive here is a conversation while a
 * false negative is an outage.
 *
 * @returns {{ masked: string, code: string, lineComments: number[], terminators: number[] }}
 */
export function maskSql(sql) {
  const masked = [];
  const code = [];
  const lineComments = [];
  const terminators = [];
  let index = 0;

  // Three ways to consume one character, all length- and newline-preserving:
  // verbatim into both outputs, blanked out of both, or blanked from `masked`
  // only (the quoted-identifier case, where `code` keeps the real name).
  const keep = () => {
    masked.push(sql[index]);
    code.push(sql[index]);
    index += 1;
  };
  const blankOne = () => {
    const filler = sql[index] === "\n" ? "\n" : " ";
    masked.push(filler);
    code.push(filler);
    index += 1;
  };
  const fillIdentifier = () => {
    masked.push(sql[index] === "\n" ? "\n" : "i");
    code.push(sql[index]);
    index += 1;
  };

  while (index < sql.length) {
    if (sql.startsWith("--", index)) {
      lineComments.push(index);
      while (index < sql.length && sql[index] !== "\n") blankOne();
      continue;
    }
    if (sql.startsWith("/*", index)) {
      let depth = 0;
      while (index < sql.length) {
        if (sql.startsWith("/*", index)) {
          depth += 1;
          blankOne();
          blankOne();
          continue;
        }
        if (sql.startsWith("*/", index)) {
          depth -= 1;
          blankOne();
          blankOne();
          if (depth === 0) break;
          continue;
        }
        blankOne();
      }
      continue;
    }
    if (sql[index] === "'") {
      keep();
      while (index < sql.length) {
        if (sql[index] === "'" && sql[index + 1] === "'") {
          blankOne();
          blankOne();
          continue;
        }
        if (sql[index] === "'") {
          keep();
          break;
        }
        blankOne();
      }
      continue;
    }
    if (sql[index] === '"') {
      keep();
      while (index < sql.length) {
        if (sql[index] === '"' && sql[index + 1] === '"') {
          fillIdentifier();
          fillIdentifier();
          continue;
        }
        if (sql[index] === '"') {
          keep();
          break;
        }
        fillIdentifier();
      }
      continue;
    }
    if (sql[index] === ";") {
      terminators.push(index);
      keep();
      continue;
    }
    keep();
  }

  return { masked: masked.join(""), code: code.join(""), lineComments, terminators };
}

const lineAt = (sql, index) => sql.slice(0, index).split("\n").length;

/**
 * The file's statements, each carrying the code text (for the excerpt and for
 * matching an acknowledgement's target), the masked-and-normalized text (for
 * matching rules), and the line its first real character sits on.
 */
export function splitStatements(sql) {
  const { masked, code, terminators } = maskSql(sql);
  const statements = [];
  let start = 0;
  for (const end of [...terminators, sql.length]) {
    const maskedChunk = masked.slice(start, end);
    if (maskedChunk.trim()) {
      const offset = maskedChunk.length - maskedChunk.trimStart().length;
      statements.push({
        code: code.slice(start, end).trim(),
        masked: maskedChunk.replace(/\s+/g, " ").trim().toUpperCase(),
        line: lineAt(sql, start + offset),
      });
    }
    start = end + 1;
  }
  return statements;
}

/**
 * The acknowledgement marker, and the six conditions that make it unreachable
 * by ordinary prose — which AGENTS.md requires of every guardrail here:
 *
 *   -- diveday:allow-destructive <rule-id> <table>.<column>: <why it is safe>
 *
 * 1. The sentinel is namespaced and colon-joined; it is a token, not a phrase.
 * 2. It must open a line comment the masker actually saw as one, so a `--`
 *    sitting inside a multi-line string literal cannot act as a marker, and a
 *    sentence that merely *mentions* the sentinel ("we considered a
 *    diveday:allow-destructive here") never matches.
 * 3. The rule id must be one this guard knows. An unknown id is a failure, not
 *    a silently-ignored line.
 * 4. Every dot-separated part of the target must appear as a word in the
 *    statement's own code — never in a comment above it — so one marker cannot
 *    blanket a file.
 * 5. The reason must carry real characters, not a shrug.
 * 6. A marker that excuses nothing is itself a failure, so a copy-pasted or
 *    outlived one surfaces instead of quietly widening the hatch.
 *
 * A line that opens with the sentinel but does not satisfy the grammar is
 * reported as malformed rather than ignored: a typo'd marker that silently did
 * nothing would read, to its author, exactly like one that worked.
 */
const ACKNOWLEDGEMENT_LINE = new RegExp(
  String.raw`^--\s*${ACKNOWLEDGEMENT}\s+([a-z][a-z0-9-]*)\s+([^\s:]+)\s*:\s*(\S.*)$`,
);

export function parseAcknowledgements(sql) {
  // Condition 2: the `--` has to be one the masker entered a comment on. A
  // line that merely *looks* like a comment because it sits inside a multi-line
  // string literal is not in this set.
  const commentStarts = new Set(maskSql(sql).lineComments);
  const acknowledgements = [];
  let lineStart = 0;

  sql.split("\n").forEach((raw, offset) => {
    const at = offset + 1;
    const indent = raw.length - raw.trimStart().length;
    const commentAt = lineStart + indent;
    lineStart += raw.length + 1;

    const line = raw.trim();
    if (!line.includes(ACKNOWLEDGEMENT)) return;
    if (!commentStarts.has(commentAt)) return;
    if (!new RegExp(String.raw`^--\s*${ACKNOWLEDGEMENT}\b`).test(line)) return;

    const parsed = ACKNOWLEDGEMENT_LINE.exec(line);
    if (!parsed) {
      acknowledgements.push({
        line: at,
        error: `malformed acknowledgement — write \`-- ${ACKNOWLEDGEMENT} <rule-id> <table>.<column>: <why it is safe>\``,
      });
      return;
    }
    const [, ruleId, target, reason] = parsed;
    if (!ruleIds.has(ruleId)) {
      acknowledgements.push({
        line: at,
        error: `acknowledgement names unknown rule "${ruleId}" — known rules: ${[...ruleIds].join(", ")}`,
      });
      return;
    }
    if (reason.trim().length < MINIMUM_REASON_LENGTH) {
      acknowledgements.push({
        line: at,
        error: `acknowledgement for "${ruleId} ${target}" needs at least ${MINIMUM_REASON_LENGTH} characters saying why the live deployment survives it`,
      });
      return;
    }
    acknowledgements.push({ line: at, ruleId, target, reason: reason.trim() });
  });

  return acknowledgements;
}

const escapeForRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Condition 4: every part of `people.full_name` appears in the statement's own
 * code. `statementCode` has comments and string literals blanked out, so a
 * marker cannot satisfy itself by quoting the column name in the sentence
 * immediately above the statement it is trying to excuse.
 */
function coversStatement(acknowledgement, statementCode) {
  const parts = acknowledgement.target
    .split(".")
    .map((part) => part.replace(/"/g, "").trim())
    .filter(Boolean);
  if (parts.length === 0) return false;
  return parts.every((part) =>
    new RegExp(`(^|[^A-Za-z0-9_])${escapeForRegExp(part)}([^A-Za-z0-9_]|$)`, "i").test(
      statementCode,
    ),
  );
}

const excerpt = (text) => {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > 90 ? `${flat.slice(0, 89)}…` : flat;
};

/**
 * One migration's problems: unacknowledged destructive statements, malformed or
 * unknown acknowledgements, and acknowledgements that excuse nothing.
 *
 * @returns {Array<{ line: number, message: string }>}
 */
export function auditMigration(sql) {
  const acknowledgements = parseAcknowledgements(sql);
  const problems = acknowledgements
    .filter((item) => item.error)
    .map((item) => ({ line: item.line, message: item.error }));
  const spent = new Set();

  for (const statement of splitStatements(sql)) {
    // All matching rules, not the first: one `ALTER TABLE` can drop a column
    // and a constraint in the same statement, and each needs its own consent.
    for (const rule of rules.filter((candidate) => ruleMatches(candidate, statement.masked))) {
      const index = acknowledgements.findIndex(
        (item) => !item.error && item.ruleId === rule.id && coversStatement(item, statement.code),
      );
      if (index === -1) {
        problems.push({
          line: statement.line,
          message: `${rule.id}: ${rule.note} — ${excerpt(statement.code)}`,
        });
      } else {
        spent.add(index);
      }
    }
  }

  acknowledgements.forEach((item, index) => {
    if (item.error || spent.has(index)) return;
    problems.push({
      line: item.line,
      message: `acknowledgement "${item.ruleId} ${item.target}" excuses no statement in this migration — remove it or fix the target`,
    });
  });

  return problems.sort((left, right) => left.line - right.line);
}

/**
 * The previous release's migration folders, read out of git by
 * `scripts/previous-release-migrations.mjs` — the same "what is new on this
 * branch" question the real-Postgres suite asks, answered the same way so the
 * two can never disagree about which migrations this release introduces.
 *
 * Unlike that suite, an unresolvable base is **not** a hard failure here. This
 * guard runs in two places with deliberately shallow checkouts — CI's
 * `repo-safeguards` job (`actions/checkout` defaults to `fetch-depth: 1`) and
 * the Vercel build container — and dying there would either take `pnpm check`
 * red on every run or, worse, invite someone to make the guard optional. The
 * fallback is the `GRANDFATHERED_THROUGH` watermark, which needs no history at
 * all and audits *more*, not less.
 *
 * @returns {{ folders: string[] | null, how: string }}
 */
export function gitBaseFolders(run) {
  const base = resolveBaseCommit(run);
  if (!base.ok) return { folders: null, how: "no reachable git history" };
  const listed = migrationPathsAt(base.commit, run);
  if (!listed.ok) return { folders: null, how: "git could not read the base tree" };
  return {
    folders: listed.paths.map((file) => path.basename(path.dirname(file))),
    how: base.how,
  };
}

/**
 * Which migrations get audited: everything on disk that the previous release
 * did not already carry *and* that postdates the watermark. Two sources of
 * "already shipped", unioned, so the answer is the smallest honest scan set in
 * both a full clone and a shallow one.
 */
export function foldersToAudit(onDisk, { gitBaseFolders: base, watermark }) {
  const shipped = new Set(base ?? []);
  return [...onDisk].filter((folder) => !shipped.has(folder) && folder > watermark).sort();
}

async function migrationFoldersOnDisk() {
  let entries;
  try {
    entries = await readdir(path.join(ROOT, MIGRATIONS_DIR), { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
  const folders = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    try {
      await readFile(path.join(ROOT, MIGRATIONS_DIR, entry.name, "migration.sql"), "utf8");
      folders.push(entry.name);
    } catch {
      // A folder with no migration.sql is not a migration drizzle would apply.
    }
  }
  return folders;
}

async function main() {
  const onDisk = await migrationFoldersOnDisk();
  const base = gitBaseFolders();
  const audited = foldersToAudit(onDisk, {
    gitBaseFolders: base.folders,
    watermark: GRANDFATHERED_THROUGH,
  });

  const violations = [];
  for (const folder of audited) {
    const file = path.join(MIGRATIONS_DIR, folder, "migration.sql");
    const sql = await readFile(path.join(ROOT, file), "utf8");
    for (const problem of auditMigration(sql)) {
      violations.push(`${file}:${problem.line}: ${problem.message}`);
    }
  }

  if (violations.length > 0) {
    console.error(
      `Destructive migration statements:\n${violations.map((v) => `- ${v}`).join("\n")}`,
    );
    console.error(
      "Migrations run inside the Vercel production build, against the schema the *previous* release's code is still serving from, and there are no down migrations. Split the change across releases using the expand/contract recipe in docs/engineering/deploy-and-migrations-runbook.md. When a statement genuinely cannot break the live deployment, say so in the migration SQL itself, on its own comment line:",
    );
    console.error(
      `  -- ${ACKNOWLEDGEMENT} <rule-id> <table>.<column>: why the live deployment survives it`,
    );
    process.exit(1);
  }

  const scope = base.folders ? `base ${base.how}` : `${base.how}; after ${GRANDFATHERED_THROUGH}`;
  console.log(
    audited.length === 0
      ? `migrations: no migrations newer than the previous release (${scope})`
      : `migrations: ${audited.length} new ${audited.length === 1 ? "migration carries" : "migrations carry"} no unacknowledged destructive DDL (${scope})`,
  );
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) await main();
