import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

// Text that leaves this repo on a deploy has to be plain ASCII. Comments and
// prose in these files get embedded into a CloudFormation template and, for
// the credentials document, an actual Secrets Manager secret string, and
// something in that pipeline mangles non-ASCII -- an em dash and two <=/>=
// symbols in infra-stack.ts came back from a real deploy as "?" (found
// 2026-08-12, via a `cdk diff` that had never previously been able to build a
// real change set -- see ADR 20260812-diff-role-assumes-file-publishing-role).
// Rather than chase where in that pipeline it happens, the deployed text just
// stays ASCII, the one encoding nothing along that path can get wrong.
//
// The guarded set is "what the deploy carries", not "what lives in infra/":
// the credentials secret embeds the *generated* `.env.example`
// (credentials-document.ts's readEnvExample, at synth), which is rendered from
// config/env-registry.mjs by scripts/render-env-example.mjs. Scoping this to
// infra/ alone missed all three, and a `cdk diff` the same day showed the
// deployed secret still holding "?" where those files' em dashes had been.
// Everywhere else (src/, docs/, the rest of scripts/) keeps normal punctuation.
const DEPLOYED_TEXT = [
  { root: "infra", extensions: new Set([".ts", ".mjs", ".js"]) },
  { files: ["config/env-registry.mjs", "scripts/render-env-example.mjs", ".env.example"] },
];

const ROOT = process.cwd();

async function walk(relativeDirectory, extensions) {
  const entries = await readdir(path.join(ROOT, relativeDirectory), { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name === "cdk.out") continue;
    const relativePath = path.join(relativeDirectory, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(relativePath, extensions)));
    else if (extensions.has(path.extname(entry.name))) files.push(relativePath);
  }
  return files;
}

const guarded = [];
for (const entry of DEPLOYED_TEXT) {
  if (entry.root) guarded.push(...(await walk(entry.root, entry.extensions)));
  else guarded.push(...entry.files);
}

const violations = [];
for (const file of guarded) {
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
  console.error(
    `deployed-text non-ASCII violations:\n${violations.map((v) => `- ${v}`).join("\n")}`,
  );
  console.error(
    '\nThis text is embedded into a deployed CloudFormation template and Secrets Manager secret, through a pipeline that has mangled non-ASCII before (ADR 20260812-diff-role-assumes-file-publishing-role); use a plain-ASCII substitute -- an em dash becomes " -- ", an arrow becomes " -> ", "S18" for "§18", "<="/">=" for "≤"/"≥", etc.',
  );
  process.exit(1);
}

console.log(
  `infra-ascii: ${guarded.length} deployed-text files are plain ASCII (the deploy pipeline mangles the rest)`,
);
