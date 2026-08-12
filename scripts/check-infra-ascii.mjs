import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

// infra/ content doesn't stay in this repo: comments and prose here get
// embedded into a CloudFormation template and, for the credentials document,
// an actual Secrets Manager secret string. Something in that deploy pipeline
// has mangled non-ASCII characters before -- an em dash and two <=/>= symbols
// in infra-stack.ts came back from a real deploy as "?" (found 2026-08-12,
// via a `cdk diff` that had never previously been able to build a real
// change set -- see ADR 20260812-diff-role-assumes-file-publishing-role).
// Rather than chase where in that pipeline the mangling happens, infra/ just
// stays plain ASCII, the one encoding nothing along that path can get wrong.
// Everywhere else in this repo (src/, scripts/, docs/) keeps its normal
// punctuation -- this rule is scoped to infra/ specifically because that is
// the only tree whose text becomes a deployed artifact.

const ROOT = process.cwd();
const INFRA_ROOT = "infra";
const SOURCE_EXTENSIONS = new Set([".ts", ".mjs", ".js"]);

async function walk(relativeDirectory) {
  const entries = await readdir(path.join(ROOT, relativeDirectory), { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name === "cdk.out") continue;
    const relativePath = path.join(relativeDirectory, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(relativePath)));
    else if (SOURCE_EXTENSIONS.has(path.extname(entry.name))) files.push(relativePath);
  }
  return files;
}

const violations = [];
for (const file of await walk(INFRA_ROOT)) {
  const text = await readFile(path.join(ROOT, file), "utf8");
  const lines = text.split("\n");
  for (const [index, line] of lines.entries()) {
    // biome-ignore lint/suspicious/noControlCharactersInRegex: \t and \n are the only control characters this allows.
    const match = line.match(/[^\x09\x0A\x20-\x7E]/);
    if (match) {
      const codePoint = match[0].codePointAt(0).toString(16).padStart(4, "0");
      violations.push(`${file}:${index + 1}: non-ASCII character "${match[0]}" (U+${codePoint})`);
    }
  }
}

if (violations.length > 0) {
  console.error(`infra/ non-ASCII violations:\n${violations.map((v) => `- ${v}`).join("\n")}`);
  console.error(
    '\ninfra/ deploys through a pipeline that has mangled non-ASCII characters before (ADR 20260812-diff-role-assumes-file-publishing-role); use a plain-ASCII substitute -- an em dash becomes " -- ", an arrow becomes " -> ", "S18" for "§18", "<="/">=" for "≤"/"≥", etc.',
  );
  process.exit(1);
}

console.log(
  "infra-ascii: infra/ is plain ASCII (deploys through a pipeline known to mangle the rest)",
);
