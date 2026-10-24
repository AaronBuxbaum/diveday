import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

/**
 * **Two form-control mistakes an axe scan cannot see**, and since the suite's scan was
 * removed on 2026-10-24, the only automated check on form controls.
 *
 * 1. **A control whose only name is its placeholder.** axe-core's `label` rule accepts a
 *    non-empty `placeholder` as a name, so the suite's axe scan passed two routes with one
 *    (2026-10-13 review): an order's line-item description beside two labelled siblings, and
 *    the brand-colour hex field, the value the profile form submits, sitting second inside a
 *    `<Field>` whose wrapping `<label>` names only its first control. A placeholder vanishes
 *    on the first keystroke and is not a label (WCAG 3.3.2). An `<input>` or `<textarea>`
 *    with a `placeholder` needs an `aria-label`, an `aria-labelledby`, an `id` a label points
 *    at, or to be the first control inside a `<Field>` or `<label>`.
 *
 * 2. **A raw `<button type="submit">` in a form posting to a server action.** Without
 *    `useFormStatus` a tap that seems not to have landed is tapped again and posts twice: a
 *    second buddy team, a refusal shown right after a success, on a wet deck
 *    (`BuddyTeamsPanel` says so in a comment, beside three raw buttons that did it). The
 *    button is a `SubmitButton`, which disables itself while the form posts. A form with
 *    `method="get"` navigates and is left alone, as is a button that owns its `disabled`
 *    state. Anything else says `diveday:allow-raw-submit: <why>` on the line or within the
 *    three lines above.
 *
 * Read off the source text rather than a parse, like the other guards (TypeScript 7 exports no
 * parser to JavaScript): an element runs from `<tag` to the first `>` outside braces, and the
 * wrapper an element sits in is the innermost `<Field`, `<label` or `<form` opened above it in
 * the same file and not yet closed. Comments are blanked first so a `<label>` named in prose
 * opens nothing. A control wrapped by a component in another file is out of reach, which is
 * why the brand field's own file is where it was caught.
 */

const ROOT = process.cwd();
const ROOTS = ["src/app", "src/components", "src/features"];
const OPT_OUT = "diveday:allow-raw-submit:";

/** Blanks block comments and whole-line `//` comments, keeping every newline in place. */
export function blankComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, " "))
    .replace(/^[ \t]*\/\/.*$/gm, (line) => " ".repeat(line.length));
}

/** The index of the `>` that closes the tag opened at `start`, skipping braces. */
function tagEnd(source, start) {
  let depth = 0;
  for (let i = start; i < source.length; i++) {
    const char = source[i];
    if (char === "{") depth++;
    else if (char === "}") depth--;
    else if (char === ">" && depth === 0) return i;
  }
  return source.length - 1;
}

const lineOf = (source, index) => source.slice(0, index).split("\n").length;

/** The innermost element named by `open` still unclosed at `index`, or `undefined`. */
function innermostOpen(source, index, open, close) {
  const stack = [];
  for (const match of source.slice(0, index).matchAll(new RegExp(`${open}|${close}`, "g"))) {
    if (new RegExp(`^${open}$`).test(match[0])) stack.push(match.index);
    else stack.pop();
  }
  return stack.at(-1);
}

const CONTROL = /<(?:input|select|textarea|ForgivingInput|DateField)\b/;
const NAMED = /\saria-label(?:ledby)?=|\sid=|\{\.\.\./;

/** `<input>` and `<textarea>` elements whose only name is their `placeholder`, by line. */
export function placeholderOnlyControls(raw) {
  const source = blankComments(raw);
  const lines = [];
  for (const match of source.matchAll(/<(?:input|textarea)\b/g)) {
    const tag = source.slice(match.index, tagEnd(source, match.index) + 1);
    if (!/\splaceholder=/.test(tag) || NAMED.test(tag) || /type="hidden"/.test(tag)) continue;
    const wrapper = innermostOpen(source, match.index, "<(?:Field|label)\\b", "</(?:Field|label)>");
    const labelled = wrapper !== undefined && !CONTROL.test(source.slice(wrapper + 1, match.index));
    if (!labelled) lines.push(lineOf(source, match.index));
  }
  return lines;
}

/** Raw submit buttons inside a form that posts to an action, by line. */
export function rawSubmits(raw) {
  const source = blankComments(raw);
  const rawLines = raw.split("\n");
  const lines = [];
  for (const match of source.matchAll(/<button\b/g)) {
    const tag = source.slice(match.index, tagEnd(source, match.index) + 1);
    if (!/\stype="submit"/.test(tag) || /\sdisabled[=\s>]/.test(tag)) continue;
    const form = innermostOpen(source, match.index, "<form\\b", "</form>");
    if (form === undefined) continue;
    const formTag = source.slice(form, tagEnd(source, form) + 1);
    if (!/\saction=\{/.test(formTag) || /\smethod="get"/i.test(formTag)) continue;
    const line = lineOf(source, match.index);
    const nearby = rawLines.slice(Math.max(0, line - 4), line).join("\n");
    if (nearby.includes(OPT_OUT)) continue;
    lines.push(line);
  }
  return lines;
}

/** Every violation in one file, as sentences. */
export function violationsIn(file, source) {
  return [
    ...placeholderOnlyControls(source).map(
      (line) =>
        `${file}:${line}: a control named only by its placeholder. Give it an aria-label from the bundle, or make it the first control inside its <Field>.`,
    ),
    ...rawSubmits(source).map(
      (line) =>
        `${file}:${line}: a raw submit button in a form that posts to an action. Use SubmitButton (name and value pass through), or say \`${OPT_OUT} <why>\`.`,
    ),
  ];
}

async function walk(directory) {
  let entries;
  try {
    entries = await readdir(path.join(ROOT, directory), { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
  const files = [];
  for (const entry of entries) {
    const relative = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(relative)));
    else if (entry.name.endsWith(".tsx") && !entry.name.includes(".test.")) files.push(relative);
  }
  return files;
}

export async function main() {
  const violations = [];
  let scanned = 0;
  for (const root of ROOTS) {
    for (const file of await walk(root)) {
      scanned++;
      const source = await readFile(path.join(ROOT, file), "utf8");
      violations.push(...violationsIn(file.split(path.sep).join("/"), source));
    }
  }
  if (violations.length > 0) {
    console.error(`form-controls violations:\n${violations.map((v) => `- ${v}`).join("\n")}`);
    process.exit(1);
  }
  console.log(
    `form-controls: ${scanned} files, every control named and every action submit guarded`,
  );
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) await main();
