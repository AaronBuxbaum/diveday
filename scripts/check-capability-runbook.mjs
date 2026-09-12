#!/usr/bin/env node
// Every bearer capability is named in the runbook an operator reads when one leaks.
//
// `docs/engineering/capability-telemetry-runbook.md` carries the rotate-and-revoke table:
// per capability, where the credential is stored and what stops an exposed copy working.
// A capability missing from that file is a credential nobody can revoke under pressure,
// because the only index an operator has of them does not know it exists.
//
// Nothing mechanical held that line, and the cost was measured rather than hypothetical.
// Closing #1730 found three live bearer capabilities absent from the file at once — the
// `handoff` purpose, `/shelf/[token]` and `/gift/[token]` — while the runbook's own
// post-mortem sentence, a few lines above the table, said that "a list that silently omits
// an entry is how the `confirm` token stayed unprotected through the first CR-001 fix".
// That sentence was describing the present tense three times over and nothing went red.
// Two stale claims in the same document survived months past the gap they recorded, for
// the same reason: the file had no reader but a person who went looking.
//
// ## Three lists, never the purpose union alone
//
// The members are read out of three places, and all three matter:
//
//   - `CAPABILITY_ROUTE_PREFIXES` (src/lib/capability-urls.ts) — the path-segment tokens.
//   - `CAPABILITY_QUERY_PARAMS` (same file) — the ones that ride a query parameter.
//   - the `CapabilityPurpose` union (src/db/booking-capabilities.ts) — the purposes one
//     `booking_capabilities` row can be minted for.
//
// A check keyed on the purpose union alone would have caught `handoff` and missed `shelf`
// and `gift`: it would have re-created the same omission one table over, which is the
// exact failure being guarded. The table also covers `waiver_records`, three
// `account_tokens` purposes, `shop_contact_email_confirmation_tokens`,
// `person_shelf_tokens`, three `display_tokens` purposes, two unsubscribe tables and two
// stateless signed shapes, so no single list is the whole surface.
//
// The lists are read out of *source text*, not imported. `CAPABILITY_QUERY_PARAMS` is
// module-local — a guard that imports the module sees only `CAPABILITY_ROUTE_PREFIXES` —
// and exporting a const for a guard's convenience widens a module's surface to suit a
// script. A list that cannot be found at all is a failure, not a pass: a guard that reads
// a renamed or deleted list as "nothing to check" goes green exactly when the thing it
// protects is gone.
//
// ## Why "named anywhere in the file" and not "has a table row"
//
// This deliberately does not parse the Markdown table. A capability can legitimately be
// described in prose *outside* it: `?gate=` is not a bearer credential at all — its
// signature unlocks a sentence rather than a resource, and verification is bound to an id
// already in the path — so it is redacted for what its value says and correctly has no
// revoke row. A guard that demanded a row would be permanently red on it, and a guard that
// is permanently red gets routed around.
//
// So the bar is that the member appears in the file as its own word. Delimited rather than
// substring, because the members are short and ordinary: `board` must not be satisfied by
// "onboarding", `ready` by "already", `claim` by "reclaimed", `gate` by "mitigate". A
// hyphen counts as part of the word, so `confirm-contact` does not stand in for `confirm`.
// Prose or row, table or footnote, any of them passes — which is why the failure message
// has to say that a mention is not a row, and that deciding which one a new capability
// needs is still the author's call.
//
// ## Hard fail, not a ratchet
//
// `check:copy` and its siblings carry a baseline because their first run found hundreds of
// hits and a guard that is red on arrival gets suppressed. This one is the opposite shape:
// the list is short, a new bearer capability is a rare and deliberate act, and the tree is
// green today. A baseline here would let the next omission live in a JSON file instead of
// in the runbook — which is precisely the failure this guard exists to stop, one file to
// the left. So there is no baseline, no `--write`, and no `--absorb`.

import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const ROOT = path.join(import.meta.dirname, "..");

const RUNBOOK = "docs/engineering/capability-telemetry-runbook.md";
const CAPABILITY_URLS = "src/lib/capability-urls.ts";
const BOOKING_CAPABILITIES = "src/db/booking-capabilities.ts";

/**
 * Where each list lives, and how a reader of the failure message should think about it.
 * `label` is the shape the member takes in the world, so the message can tell an author
 * what they are being asked to write about.
 */
const SOURCES = [
  {
    file: CAPABILITY_URLS,
    kind: "array",
    name: "CAPABILITY_ROUTE_PREFIXES",
    label: "route prefix",
    plural: "route prefixes",
    shape: (member) => `/${member}/[token]`,
  },
  {
    file: CAPABILITY_URLS,
    kind: "array",
    name: "CAPABILITY_QUERY_PARAMS",
    label: "query parameter",
    plural: "query parameters",
    shape: (member) => `?${member}=`,
  },
  {
    file: BOOKING_CAPABILITIES,
    kind: "union",
    name: "CapabilityPurpose",
    label: "booking-capability purpose",
    plural: "booking-capability purposes",
    shape: (member) => `purpose = '${member}'`,
  },
];

/**
 * Comments are stripped before any list is read. Both source files interleave long
 * docblocks *between* array entries, and those comments quote route templates like
 * `/unsubscribe/[token]` — a `]` inside a comment would truncate the array match, and a
 * quoted string inside one would be collected as a member that does not exist.
 */
export function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

const quotedStrings = (text) =>
  [...text.matchAll(/"([^"\n]+)"|'([^'\n]+)'/g)].map((match) => match[1] ?? match[2]);

/** The string literals of `const <name> = [ … ]`, or null when no such array is there. */
export function parseArrayMembers(source, name) {
  const body = new RegExp(`\\b${name}\\s*=\\s*\\[([^\\]]*)\\]`).exec(stripComments(source));
  return body ? quotedStrings(body[1]) : null;
}

/** The string literals of `type <name> = "a" | "b";`, or null when no such type is there. */
export function parseUnionMembers(source, name) {
  const body = new RegExp(`\\btype\\s+${name}\\s*=([^;]*);`).exec(stripComments(source));
  return body ? quotedStrings(body[1]) : null;
}

export function parseMembers(source, { kind, name }) {
  return kind === "union" ? parseUnionMembers(source, name) : parseArrayMembers(source, name);
}

/**
 * Whether the runbook names this member as its own word. A hyphen and an underscore count
 * as part of the word; everything else is a delimiter.
 */
export function namesMember(runbook, member) {
  const escaped = member.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^0-9A-Za-z_-])${escaped}($|[^0-9A-Za-z_-])`, "i").test(runbook);
}

/** The members of `lists` the runbook does not name. `lists` is `[{ …source, members }]`. */
export function findUnnamedMembers(lists, runbook) {
  const unnamed = [];
  for (const list of lists) {
    for (const member of list.members) {
      if (!namesMember(runbook, member)) unnamed.push({ ...list, member });
    }
  }
  return unnamed;
}

// Imported by the test, which must not read the tree or exit the process.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const read = (file) => readFile(path.join(ROOT, file), "utf8");

  let runbook;
  try {
    runbook = await read(RUNBOOK);
  } catch {
    console.error(
      `${RUNBOOK} is missing. It is the rotate-and-revoke index an operator reads when a capability URL leaks; restore it rather than deleting this guard.`,
    );
    process.exit(1);
  }

  const sourceText = new Map(
    await Promise.all(
      [CAPABILITY_URLS, BOOKING_CAPABILITIES].map(async (file) => [file, await read(file)]),
    ),
  );

  const lists = [];
  const missingLists = [];
  for (const source of SOURCES) {
    const members = parseMembers(sourceText.get(source.file), source);
    if (members === null || members.length === 0) {
      missingLists.push(`- ${source.file}: ${source.name}`);
      continue;
    }
    lists.push({ ...source, members });
  }

  if (missingLists.length > 0) {
    console.error(
      `Capability lists this guard could not read:\n${missingLists.join("\n")}\n` +
        "A renamed or deleted list reads as nothing to check, which turns this guard green exactly when the capabilities it indexes stop being tracked. Point the guard at the new name in the same change that renames the list.",
    );
    process.exit(1);
  }

  const unnamed = findUnnamedMembers(lists, runbook);

  if (unnamed.length > 0) {
    console.error(
      `Bearer capabilities the runbook never names:\n${unnamed
        .map(
          ({ file, name, label, member, shape }) =>
            `- ${member} (${label}, from ${name} in ${file}) — looks like \`${shape(member)}\``,
        )
        .join("\n")}`,
    );
    console.error(
      `Write each one into ${RUNBOOK}. A mention is not a row: this guard only asks that the file names the capability somewhere, because \`?gate=\` is deliberately described in prose and deliberately has no row — it is redacted for what its value says, not as a bearer credential. Which one yours needs is still your call. If it is a credential somebody could be holding, it belongs in the rotate-and-revoke table with its storage and what revokes it; if it is not, say so in prose and say why, so the next sweep stops re-finding it as a hole.`,
    );
    process.exit(1);
  }

  console.log(
    `capability-runbook: ${lists.reduce((total, list) => total + list.members.length, 0)} capabilities named in the runbook (${lists
      .map((list) => `${list.members.length} ${list.plural}`)
      .join(", ")})`,
  );
}
