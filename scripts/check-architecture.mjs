import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { filesUnder } from "./files-under.mjs";
import { bankCounts, ratchetFlags, readCounts } from "./ratchet.mjs";

/**
 * Layout invariants (docs ADR 20260730-feature-module-contracts).
 *
 * 1. **Dependency direction.** Domain (`src/lib`) and data (`src/db`) code must
 *    never import from `src/app` or from `src/features`. They sit below both:
 *    a feature composes them, not the other way round. Without this a "shared
 *    helper" quietly acquires a route's or a feature's dependencies and stops
 *    being testable without them. The same direction holds one level up:
 *    shared UI (`src/components`) and copy plumbing (`src/i18n`) are composed
 *    *by* routes, so neither may import from `src/app`, and `src/i18n` — a
 *    lib-level layer — may not import shared UI or feature modules either
 *    (review finding ARCH-2: these two roots previously floated under no rule).
 *
 * 2. **Seams the direction table cannot say**, because each is about
 *    *what kind* of import crosses rather than whether any may:
 *    - `src/lib` → `src/db` *value* imports. `src/lib` is the framework-free
 *      domain layer (`.claude/rules/domain.md`): a type from a db module is a
 *      shape it may name, but a value import puts a query, and through
 *      `src/db/client.ts` the whole database bootstrap, under a module that
 *      is supposed to be testable without one. A lib file that needs to read
 *      is a loader, and a loader lives in `src/db` or a feature module.
 *    - `src/app` → `drizzle-orm`. A route that builds its own query is a query
 *      no `src/db` test covers and no tenant-scope reader sees; it becomes a
 *      named function in `src/db` instead (routes stay thin, AGENTS.md).
 *    - `src/lib` → `drizzle-orm` (value imports): the same reason one level down.
 *      A lib file that builds a query is a loader in disguise; the query half is a
 *      named function in `src/db`, the twin the name pairs already model.
 *    - `src/db` → the translators (`@/i18n/messages`, `@/i18n/staff-messages`,
 *      value imports): `src/db` returns codes and data and the caller words them.
 *      An outbound message is worded by its renderer in `src/lib/notifications/`
 *      (`reminder-text.ts`, `staff-push.ts`, `reply-keyword-text.ts`, …), which
 *      the db sender calls with a locale and the facts. Today's queue still
 *      words its rows and is banked until the Today move (issue #2756).
 *    - Anything outside `src/db` → `@/db/trips-*` or `@/db/seed-*`. The trips
 *      modules are reached through the `@/db/trips` barrel and the seed
 *      scenarios through `@/db/seed` (AGENTS.md route map), so a sibling can be
 *      split or merged without a repo-wide edit. A trip page's surface reader
 *      (`trip-overview.ts`, …) is not a trips sibling and is imported by name.
 *    - `src/lib` and `src/db` → `src/i18n` *value* imports (issue #2772). Words are chosen
 *      in a renderer: the page, the message (`src/lib/notifications/**`) and the file.
 *      The rest returns codes and keys. A type is a shape and passes.
 *    Test code is exempt from all of these (test files, `src/test/`, and the e2e
 *    fixture routes under `src/app/api/test/`): a test builds and inspects its
 *    own rows, and that is not a layering decision.
 *
 * 3. **Feature modules have a contract.** A `src/features/<feature>/` module
 *    publishes exactly one entry point — its `index.ts` — and documents itself
 *    in a `README.md`. Nothing outside the module may reach past the index.
 *    That is what makes the internals genuinely internal: a file can be split,
 *    renamed, or merged without a repo-wide edit, and the module's surface is
 *    reviewable in one file rather than inferred from every call site.
 *
 * 5. **An index is a door** (issue #2754). A directory directly under `src/lib`
 *    or `src/db` that contains an `index.ts` is a module, and from outside it
 *    only the index is importable: a file beside it is the module's own, free
 *    to be split or merged without a repo-wide edit, and adding a function to
 *    a sibling does not publish it. (`src/features` modules say the same in
 *    rule 3, with a README.) Tests are exempt, like every seam.
 *
 * 6. **A staff page reads through one reader** (issue #2757). Every
 *    `page.tsx` under `src/app/shop` value-imports at most one `@/db/*` module:
 *    the surface reader that answers that page's question in one call
 *    (`.claude/rules/db.md`, "Two kinds of module"). A permission the page
 *    needs, a constant it renders and the rows it lists come back from that
 *    reader, so a page's question has one place to be answered and one
 *    query budget to hold. A type import is a shape and passes; a Server
 *    Action file and a component are not pages.
 *
 * 7. **A table module writes by transition** (issue #2757). An exported
 *    `src/db` function is never named `update…` or `save…`: a write is named
 *    for what happened to the row (`record`, `mark`, `issue`, `claim`,
 *    `release`, `consume`, `restore`, `cancel`, `edit`), so a grep for a
 *    transition finds every place it is written.
 *
 * 4. **Server-only modules stay out of client bundles.** A module in
 *    `SERVER_ONLY_MODULES` (or a `libphonenumber-js` import) must not be
 *    reachable by value imports from any `"use client"` file. The phone line-type
 *    metadata is about 100 kB the browser has no use for (ADR
 *    20261014-phone-line-type-metadata); the repo has no `server-only` package, so the
 *    import graph is the only thing keeping it out, and this walks it. The walk stops at a
 *    `"use server"` module (a Server Action file): a client file gets a call stub for it, and
 *    nothing it imports reaches the browser (issue #3635).
 *
 * ## The ratchet
 *
 * Widening the forbidden table found pre-existing debt (shared components in
 * `src/components/today/` importing server actions from `src/app/actions/`),
 * and unwinding it means moving files, not deleting an import — too structural
 * to mass-fix in the change that adds the rule. So, exactly like
 * `check-copy.mjs`, its section of `scripts/ratchets.json` records how many violations
 * each file still carries. A file not in the baseline may have none, a file's
 * count may never rise, and a count that falls must be banked in the same
 * change (`node scripts/check-architecture.mjs --write`, which refuses to
 * raise anything; `--absorb` records growth arriving from a merge). The
 * baseline can only ever go down. There is no inline-disable comment on
 * purpose: the escape hatch is a reviewable baseline entry, nothing else.
 */

const ROOT = process.cwd();
/** Rule 6: every `page.tsx` under here is a staff page. */
const STAFF_PAGES_ROOT = "src/app/shop";
/** Rule 7: an exported `src/db` function named for a vague write. */
const VAGUE_WRITER = /export\s+(?:async\s+)?function\s+((?:update|save)[A-Z]\w*)/g;
const FEATURES_DIR = "src/features";
const sourceExtensions = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);

/**
 * Every form an import takes. The first alternation covers `import x from`,
 * `export … from`, dynamic `import(…)`, and `require(…)`; the second covers
 * the bare side-effect form — `import "@/app/x"` — which the original pattern
 * missed entirely (review finding ARCH-2), so a file could take a banned
 * dependency invisibly as long as it didn't bind a name to it.
 */
export const importPattern =
  /(?:from\s+|import\s*\(|require\s*\()\s*["']([^"']+)["']|\bimport\s+["']([^"']+)["']/g;

/** Layers that may not import from these prefixes. */
export const forbidden = [
  { root: "src/lib", banned: ["src/app", "src/features"] },
  { root: "src/db", banned: ["src/app", "src/features"] },
  { root: "src/features", banned: ["src/app"] },
  { root: "src/components", banned: ["src/app", "src/features"] },
  // The service worker is a fourth composition root (ADR
  // 20260804-manifest-web-push): it is compiled separately and imports the
  // domain layer directly, so it sits beside `src/app` rather than under it.
  // Listed for the same reason ARCH-2 listed components and i18n — a root that
  // floats under no rule is one nobody notices growing an upward import.
  { root: "src/worker", banned: ["src/app", "src/features", "src/components"] },
  { root: "src/i18n", banned: ["src/app", "src/features", "src/components"] },
];

/**
 * The import seams the forbidden table cannot express (rule 2 above). Each
 * names the importing roots it watches, the targets it refuses, and whether a
 * type-only import is let through.
 */
export const seams = [
  {
    roots: ["src/lib"],
    refuses: (target) => target !== null && isWithin(target, "src/db"),
    typeOnlyAllowed: true,
    message: (file, specifier) =>
      `${file}: value-imports ${specifier} — src/lib is the framework-free domain layer; a type import is fine, a loader belongs in src/db or a feature module`,
  },
  {
    roots: ["src/lib"],
    refuses: (_target, specifier) => /^drizzle-orm(?:\/|$)/.test(specifier),
    typeOnlyAllowed: true,
    message: (file, specifier) =>
      `${file}: value-imports ${specifier} — src/lib is the framework-free domain layer and builds no query; the query half is a named function in src/db (the twin the name pairs already model)`,
  },
  {
    // Words are chosen in a renderer and nowhere else (issue #2772, ADR
    // 20260731-domain-layer-copy-leaks): the page, the message (the notification
    // senders) and the file. Everything else in `src/lib` and `src/db` hands back
    // codes and keys, so a translator defaulting to "en-US" cannot hide in a domain
    // function. A type (`StaffMessageKey`, `StaffTranslator`) is a shape and passes.
    roots: ["src/lib", "src/db"],
    exempt: (file) => file.replaceAll(path.sep, "/").startsWith("src/lib/notifications/"),
    refuses: (target) =>
      target !== null &&
      isWithin(target, "src/i18n") &&
      path.normalize(target) !== path.normalize("src/i18n/settings"),
    typeOnlyAllowed: true,
    message: (file, specifier) =>
      `${file}: value-imports ${specifier} — src/lib and src/db return codes and keys; the page, the message or the file words them (a type import is fine)`,
  },
  {
    // Staff copy never reaches an anonymous page (ADR 20260811-staff-copy-provider): the staff
    // provider and its hook are named only from the staff surface, so a diver or token layout
    // cannot mount a `staff` namespace. A type import is a shape and passes.
    roots: ["src/app", "src/components", "src/features", "src/lib", "src/worker"],
    exempt: (file) => {
      const normal = file.replaceAll(path.sep, "/");
      return normal.startsWith("src/app/shop/") || normal.startsWith("src/app/offline-manifest/");
    },
    refuses: (target) =>
      target !== null &&
      (path.normalize(target) === path.normalize("src/i18n/StaffIntlProvider") ||
        path.normalize(target) === path.normalize("src/i18n/use-staff-translations")),
    typeOnlyAllowed: true,
    message: (file, specifier) =>
      `${file}: imports ${specifier} — a staff namespace may only be provided from src/app/shop or src/app/offline-manifest, so staff copy never reaches an anonymous page`,
  },
  {
    roots: ["src/app"],
    refuses: (_target, specifier) => /^drizzle-orm(?:\/|$)/.test(specifier),
    typeOnlyAllowed: false,
    message: (file, specifier) =>
      `${file}: imports ${specifier} — a route never builds its own query; name it in src/db`,
  },
  {
    roots: ["src/app", "src/components", "src/features", "src/lib", "src/worker", "src/i18n"],
    refuses: (target) =>
      target !== null &&
      path.dirname(target) === "src/db" &&
      /^(?:trips|seed)-/.test(path.basename(target)),
    typeOnlyAllowed: false,
    message: (file, specifier) =>
      /\/seed-/.test(specifier)
        ? `${file}: imports ${specifier} — reach the seed scenarios through the "@/db/seed" barrel`
        : `${file}: imports ${specifier} — reach the trips modules through the "@/db/trips" barrel`,
  },
];

/** Modules a client bundle must never reach, by value import, at any depth. */
export const SERVER_ONLY_MODULES = [
  "src/lib/phone-line-type.ts",
  "src/lib/payments/stripe-keys.ts",
  "src/lib/payments/stripe-client.ts",
  "src/lib/payments/webhook.ts",
];
const SERVER_ONLY_PACKAGE = /^libphonenumber-js(?:\/|$)/;

const MODULE_ROOTS = ["src/lib", "src/db"];

/** Every `src/lib/<name>` and `src/db/<name>` directory that has an `index.ts(x)`. */
async function moduleDirectories(root) {
  const modules = [];
  for (const moduleRoot of MODULE_ROOTS) {
    let entries = [];
    try {
      entries = await readdir(path.join(root, moduleRoot), { withFileTypes: true });
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    for (const entry of entries.filter((item) => item.isDirectory())) {
      const directory = `${moduleRoot}/${entry.name}`;
      for (const index of ["index.ts", "index.tsx"]) {
        try {
          await stat(path.join(root, directory, index));
          modules.push(directory);
          break;
        } catch {}
      }
    }
  }
  return modules;
}

/** The repo file a specifier names, or null for a package or a file not on disk. */
async function resolveFile(root, importer, specifier) {
  const base = resolveSpecifier(importer, specifier);
  if (!base) return null;
  const candidates = [
    base,
    ...[".ts", ".tsx", ".js", ".mjs"].map((extension) => base + extension),
    ...[".ts", ".tsx"].map((extension) => path.join(base, `index${extension}`)),
  ];
  for (const candidate of candidates) {
    try {
      if ((await stat(path.join(root, candidate))).isFile()) return candidate;
    } catch {}
  }
  return null;
}

/**
 * Rule 4: from each `"use client"` file, follow value imports; a server-only
 * module or package reached anywhere on the way is a violation on that file.
 */
async function clientReachViolations(root, record) {
  const sources = new Map();
  const read = async (file) => {
    if (!sources.has(file)) sources.set(file, await readFile(path.join(root, file), "utf8"));
    return sources.get(file);
  };
  const reach = new Map();
  const reaches = async (file) => {
    if (reach.has(file)) return reach.get(file);
    reach.set(file, null);
    let found = null;
    if (startsWithDirective(await read(file), "use server")) return null;
    for (const { specifier, typeOnly } of importsOf(await read(file))) {
      if (typeOnly) continue;
      if (SERVER_ONLY_PACKAGE.test(specifier)) {
        found = specifier;
        break;
      }
      const target = await resolveFile(root, file, specifier);
      if (!target) continue;
      if (SERVER_ONLY_MODULES.includes(target.replaceAll(path.sep, "/"))) {
        found = target;
        break;
      }
      found = await reaches(target);
      if (found) break;
    }
    reach.set(file, found);
    return found;
  };
  for (const file of await walk(root, "src")) {
    if (isTestFile(file)) continue;
    const contents = await read(file);
    if (!startsWithUseClient(contents)) continue;
    const found = await reaches(file);
    if (found) {
      record(
        file,
        `${file.replaceAll(path.sep, "/")}: a "use client" file reaches server-only ${found} — the browser would download it; keep the import on the server side`,
      );
    }
  }
}

/** True when the first statement is a "use client" directive, after leading comments. */
function startsWithUseClient(contents) {
  return startsWithDirective(contents, "use client");
}

/**
 * True when the first statement is the `directive` string, after leading comments. A
 * `"use server"` module imported from a client file is a reference the framework swaps in, not
 * code the browser downloads, so the reach walk stops there.
 */
function startsWithDirective(contents, directive) {
  let rest = contents.trimStart();
  for (;;) {
    if (rest.startsWith("/*")) {
      const end = rest.indexOf("*/");
      if (end < 0) return false;
      rest = rest.slice(end + 2).trimStart();
    } else if (rest.startsWith("//")) {
      const end = rest.indexOf("\n");
      if (end < 0) return false;
      rest = rest.slice(end + 1).trimStart();
    } else break;
  }
  return rest.startsWith(`"${directive}"`) || rest.startsWith(`'${directive}'`);
}

/**
 * Test code, exempt from the seams: test files, the shared harness in
 * `src/test/`, and the e2e fixture routes under `src/app/api/test/`, which
 * exist to write rows a spec needs and are closed outside the harness
 * (`src/lib/e2e-test-routes.ts`).
 */
const isTestFile = (file) => {
  const posix = file.replaceAll(path.sep, "/");
  return (
    /\.test\.[cm]?[jt]sx?$/.test(posix) ||
    posix.startsWith("src/test/") ||
    posix.startsWith("src/app/api/test/")
  );
};

/**
 * Every import in a file with whether it is type-only: `import type …`,
 * `export type …`, or a braced list in which every name says `type`. Static
 * statements are read whole from their first line to their `from`, which is
 * how Biome formats every one of them; a dynamic `import("…")` or a
 * `require("…")` is always a value.
 */
export function importsOf(contents) {
  const found = [];
  const lines = contents.split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    if (!/^\s*(?:import|export)\b/.test(lines[index])) continue;
    let statement = lines[index];
    while (
      !/\bfrom\s*["'][^"']+["']/.test(statement) &&
      !/^\s*import\s*["']/.test(statement) &&
      !/;\s*$/.test(statement) &&
      index + 1 < lines.length
    ) {
      index += 1;
      statement += `\n${lines[index]}`;
    }
    const from = statement.match(/\bfrom\s*["']([^"']+)["']/);
    const bare = statement.match(/^\s*import\s*["']([^"']+)["']/);
    const specifier = from?.[1] ?? bare?.[1];
    if (!specifier) continue;
    found.push({ specifier, typeOnly: from ? isTypeOnlyClause(statement) : false });
  }
  for (const match of contents.matchAll(/(?:\bimport|\brequire)\s*\(\s*["']([^"']+)["']\s*\)/g)) {
    found.push({ specifier: match[1], typeOnly: false });
  }
  return found;
}

function isTypeOnlyClause(statement) {
  const clause = statement
    .replace(/\bfrom\s*["'][^"']+["'][\s;]*$/, "")
    .replace(/^\s*(?:import|export)\s+/, "")
    .trim();
  if (/^type\b/.test(clause)) return true;
  const braced = clause.match(/^\{([\s\S]*)\}$/);
  if (!braced) return false;
  const names = braced[1]
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean);
  return names.length > 0 && names.every((name) => /^type\s/.test(name));
}

async function walk(root, relativeDirectory) {
  return filesUnder(
    relativeDirectory,
    (directory) => readdir(path.join(root, directory), { withFileTypes: true }),
    (_relativePath, entry) => sourceExtensions.has(path.extname(entry.name)),
  );
}

/**
 * The repo-relative path an import resolves to, or null for a bare package
 * specifier. `@/x` is the tsconfig alias for `src/x`.
 */
export function resolveSpecifier(importer, specifier) {
  if (specifier.startsWith("@/")) return path.normalize(`src/${specifier.slice(2)}`);
  if (specifier.startsWith("."))
    return path.normalize(path.join(path.dirname(importer), specifier));
  return null;
}

function isWithin(target, root) {
  const normalized = path.normalize(root);
  return target === normalized || target.startsWith(`${normalized}${path.sep}`);
}

/** `src/features/calendar-sync/feed-store` → `calendar-sync`, else null. */
function featureOf(target) {
  const prefix = `${path.normalize(FEATURES_DIR)}${path.sep}`;
  if (!target.startsWith(prefix)) return null;
  return target.slice(prefix.length).split(path.sep)[0] || null;
}

/**
 * Every violation in the tree, as a Map of repo-relative file (posix
 * separators, so the baseline is stable across platforms) → messages. The
 * feature-contract rule keys on the module directory, the import rules on the
 * importing file.
 */
export async function collectViolations(root = ROOT) {
  const violations = new Map();
  const record = (file, message) => {
    const key = file.replaceAll(path.sep, "/");
    if (!violations.has(key)) violations.set(key, []);
    violations.get(key).push(message);
  };

  // 1. Dependency direction.
  for (const { root: layerRoot, banned } of forbidden) {
    for (const file of await walk(root, layerRoot)) {
      const contents = await readFile(path.join(root, file), "utf8");
      for (const match of contents.matchAll(importPattern)) {
        const specifier = match[1] ?? match[2];
        const target = resolveSpecifier(file, specifier);
        if (!target) continue;
        for (const bannedRoot of banned) {
          if (isWithin(target, bannedRoot)) record(file, `${file}: imports ${specifier}`);
        }
      }
    }
  }

  // 2. The seams.
  for (const seam of seams) {
    for (const seamRoot of seam.roots) {
      for (const file of await walk(root, seamRoot)) {
        if (isTestFile(file) || seam.exempt?.(file)) continue;
        const contents = await readFile(path.join(root, file), "utf8");
        for (const { specifier, typeOnly } of importsOf(contents)) {
          if (typeOnly && seam.typeOnlyAllowed) continue;
          if (seam.refuses(resolveSpecifier(file, specifier), specifier)) {
            record(file, seam.message(file.replaceAll(path.sep, "/"), specifier));
          }
        }
      }
    }
  }

  // 5. An index is a door.
  const modules = await moduleDirectories(root);
  if (modules.length > 0) {
    for (const file of await walk(root, "src")) {
      if (isTestFile(file)) continue;
      const posix = file.replaceAll(path.sep, "/");
      const contents = await readFile(path.join(root, file), "utf8");
      for (const { specifier } of importsOf(contents)) {
        const target = resolveSpecifier(file, specifier)?.replaceAll(path.sep, "/");
        if (!target) continue;
        const module = modules.find((directory) => target.startsWith(`${directory}/`));
        if (!module || posix.startsWith(`${module}/`)) continue;
        if (/^index(\.[cm]?[jt]sx?)?$/.test(target.slice(module.length + 1))) continue;
        record(
          file,
          `${posix}: imports ${specifier} — ${module} is a module, reach it through "@/${module.slice(4)}" (its index.ts)`,
        );
      }
    }
  }

  // 6. A staff page reads through one reader.
  for (const file of await walk(root, STAFF_PAGES_ROOT)) {
    if (isTestFile(file) || path.basename(file) !== "page.tsx") continue;
    const readers = new Set();
    for (const { specifier, typeOnly } of importsOf(
      await readFile(path.join(root, file), "utf8"),
    )) {
      if (!typeOnly && /^@\/db\//.test(specifier)) readers.add(specifier);
    }
    if (readers.size > 1) {
      const posix = file.replaceAll(path.sep, "/");
      for (const specifier of [...readers].sort().slice(1)) {
        record(
          file,
          `${posix}: reads ${[...readers].sort().join(", ")} — a staff page reads through requireShopSurface and one surface reader; fold ${specifier} into it`,
        );
      }
    }
  }

  // 7. A table module writes by transition.
  for (const file of await walk(root, "src/db")) {
    if (isTestFile(file)) continue;
    const contents = await readFile(path.join(root, file), "utf8");
    for (const match of contents.matchAll(VAGUE_WRITER)) {
      record(
        file,
        `${file.replaceAll(path.sep, "/")}: exports ${match[1]} — name a write by its transition (record, mark, issue, claim, release, consume, restore, cancel, edit…), never update or save`,
      );
    }
  }

  // 4. Server-only modules never reach a client bundle.
  await clientReachViolations(root, record);

  // 3. Feature-module contract.
  let features = [];
  try {
    features = (await readdir(path.join(root, FEATURES_DIR), { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }

  for (const feature of features) {
    for (const required of ["index.ts", "README.md"]) {
      const target = path.join(root, FEATURES_DIR, feature, required);
      try {
        await stat(target);
      } catch {
        record(
          `${FEATURES_DIR}/${feature}`,
          `${FEATURES_DIR}/${feature}: missing ${required} — every feature module publishes one entry point and documents itself`,
        );
      }
    }
  }

  // Nothing outside a feature module may reach past its index. Scanning whole
  // roots rather than a hand-listed set of subtrees: an enumerated list silently
  // stops covering `src/i18n`, `src/test`, and any directory added later, and a
  // boundary with unwatched gaps is not a boundary.
  for (const scanRoot of ["src", "e2e", "scripts"]) {
    for (const file of await walk(root, scanRoot)) {
      const importerFeature = featureOf(path.normalize(file));
      const contents = await readFile(path.join(root, file), "utf8");
      for (const match of contents.matchAll(importPattern)) {
        const specifier = match[1] ?? match[2];
        const target = resolveSpecifier(file, specifier);
        if (!target) continue;
        const targetFeature = featureOf(target);
        if (!targetFeature) continue;
        // Inside the same module, any internal file is fair game.
        if (importerFeature === targetFeature) continue;
        const index = path.normalize(`${FEATURES_DIR}/${targetFeature}`);
        if (target !== index && target !== path.join(index, "index")) {
          record(
            file,
            `${file}: deep-imports ${specifier} — import from "@/features/${targetFeature}" instead`,
          );
        }
      }
    }
  }

  return violations;
}

/**
 * The ratchet verdict: every violation in a file with no baseline entry, every
 * file whose count rose, and every file whose count fell without the baseline
 * being lowered in the same change. Identical semantics to `check-copy.mjs`.
 */
export function auditBaseline(violations, baselineCounts) {
  const failures = [];
  for (const [file, messages] of violations) {
    const allowed = baselineCounts[file];
    if (allowed === undefined) {
      failures.push(...messages.map((message) => message));
      continue;
    }
    if (messages.length > allowed) {
      failures.push(
        `${file}: ${messages.length} boundary violations, baseline allows ${allowed}. Fix the new import instead of raising the number.`,
      );
    }
    if (messages.length < allowed) {
      failures.push(
        `${file}: down to ${messages.length} from ${allowed} — lower the baseline in this change (\`node scripts/check-architecture.mjs --write\`).`,
      );
    }
  }
  for (const file of Object.keys(baselineCounts)) {
    if (!violations.has(file)) {
      failures.push(
        `${file}: clean or gone — remove its baseline entry (\`node scripts/check-architecture.mjs --write\`).`,
      );
    }
  }
  return failures;
}

async function main() {
  const violations = await collectViolations(ROOT);
  const { counts: baselineCounts, exists: baselineExists } = await readCounts(ROOT, "architecture");
  const { write, absorb } = ratchetFlags();
  if (write || absorb !== null) {
    process.exit(
      await bankCounts({
        root: ROOT,
        guard: "architecture",
        counts: violations,
        allowed: baselineCounts,
        exists: baselineExists,
        note: "Pre-existing architecture-boundary violations, per file. Written by `node scripts/check-architecture.mjs --write`. This number may only go down — see scripts/check-architecture.mjs.",
        refusal: "The ratchet only turns one way — fix the imports instead",
        absorb,
        summary: (files, total) => `${files} files, ${total} violations still to unwind`,
      }),
    );
  }

  const failures = auditBaseline(violations, baselineCounts);
  if (failures.length > 0) {
    console.error(
      `Architecture boundary violations:\n${failures.map((item) => `- ${item}`).join("\n")}`,
    );
    console.error(
      "Domain code must not import from src/app or src/features, src/components and src/i18n must not import from src/app, a feature module, or a src/lib or src/db directory with an index.ts, is reachable only through its index.ts, src/lib takes only types from src/db, src/app never imports drizzle-orm, the trips modules are reached through @/db/trips, and the seed scenarios through @/db/seed. See docs/architecture/decisions/20260730-feature-module-contracts.md and the header of scripts/check-architecture.mjs.",
    );
    process.exit(1);
  }

  const remaining = [...violations.values()].reduce((sum, messages) => sum + messages.length, 0);
  console.log(
    remaining > 0
      ? `architecture: no new boundary violations — ${remaining} pre-existing across ${violations.size} files still to unwind`
      : "architecture: layer boundaries and feature-module contracts valid",
  );
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) await main();
