import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

/**
 * **No medical answer can reach a Claude prompt** (ADR 20261018-claude-assists,
 * security review N2 on L1).
 *
 * The plan's rule is that medical answers are never sent to Anthropic, and
 * nothing in the seam can enforce it: `runAssist` sends whatever `content` and
 * `context` its caller built. So the guard is on what a prompt-building module
 * can *reach*. A module that builds or sends a prompt is one under
 * `src/lib/assists/` (the prompts), a `src/db/*assist*.ts` module, or any
 * module that names `runAssist` or `runAssistOutcome`, or imports the seam
 * (`@/db/assists`, `./assists`) by alias or relative path (security review
 * L3, B1). None may import a medical reader: a module
 * whose path names `medical` or `questionnaire`, the waiver-records schema,
 * or the waiver module that reads the answers. Neither may name the answer
 * columns (`medicalAnswers`, `medical_answers`) at all.
 *
 * Left alone: test files, and every module that does not build a prompt.
 */
const ROOT = process.cwd();
const SOURCE = /\.(?:[cm]?[jt]sx?)$/;
const TEST = /\.test\.[cm]?[jt]sx?$/;
const IMPORT =
  /\b(?:import|export)\s+(?:[^;]*?\s+from\s+)?["']([^"']+)["']|\bimport\(\s*["']([^"']+)["']\s*\)/g;
// A caller of the seam by any spelling: the call itself, or the module by its
// alias or a relative path. `src/db/*.ts` imports it as `./assists`, which an
// alias-only pattern missed (security review L2, B1).
const SENDS = /\b(?:runAssist|runAssistOutcome)\b|["'](?:@\/db|\.\.?(?:\/\.\.)*)\/assists["']/;
// A db module named for the assists builds their inputs, whatever it imports.
const ASSIST_DB_MODULE = /^src\/db\/[^/]*assist[^/]*\.[cm]?[jt]sx?$/;
const MEDICAL_SPECIFIER =
  /medical|questionnaire|waiver-records|(?:@\/lib|@\/db|^\.\.?(?:\/\.\.)*)\/waivers$/i;
const MEDICAL_NAME = /\bmedical_?answers\b|\bmedicalAnswers\b/i;
const PROMPTS = "src/lib/assists/";

async function walk(relative) {
  let entries;
  try {
    entries = await readdir(path.join(ROOT, relative), { withFileTypes: true });
  } catch {
    return [];
  }
  const files = [];
  for (const entry of entries) {
    const child = path.posix.join(relative, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(child)));
    else if (SOURCE.test(entry.name) && !TEST.test(entry.name)) files.push(child);
  }
  return files;
}

const violations = [];
let scanned = 0;
for (const file of await walk("src")) {
  const text = await readFile(path.join(ROOT, file), "utf8");
  if (!file.startsWith(PROMPTS) && !ASSIST_DB_MODULE.test(file) && !SENDS.test(text)) continue;
  // The seam itself, and the schema barrel (whose `./assists` is the usage table).
  if (file === "src/db/assists.ts" || file.startsWith("src/db/schema/")) continue;
  scanned += 1;
  for (const match of text.matchAll(IMPORT)) {
    const specifier = match[1] ?? match[2] ?? "";
    if (!MEDICAL_SPECIFIER.test(specifier)) continue;
    const line = text.slice(0, match.index).split("\n").length;
    violations.push(`${file}:${line}: imports ${specifier}`);
  }
  const lines = text.split("\n");
  lines.forEach((line, index) => {
    if (MEDICAL_NAME.test(line)) violations.push(`${file}:${index + 1}: names medical answers`);
  });
}

if (violations.length > 0) {
  console.error(
    `assist-prompts: ${violations.length} way(s) a medical answer could reach a Claude prompt. A module that builds or sends a prompt (under ${PROMPTS}, a src/db/*assist* module, or calling runAssist or runAssistOutcome) must not read medical data:\n${violations.map((v) => `- ${v}`).join("\n")}`,
  );
  process.exit(1);
}

console.log(`assist-prompts: ${scanned} prompt module(s), none reads medical data`);
