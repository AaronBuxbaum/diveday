/**
 * Reading `anonymize.ts` as source, shared by the erasure guards
 * (`erasure-coverage.test.ts`, `erasure-registry.test.ts`): the static reads see
 * every branch, where one recorded run sees only the ones its fixture fires.
 */

/**
 * Blank out line comments, block comments and string/template literals, keeping
 * the source's length so nothing else shifts. Crude on purpose: it only has to
 * stop a `.update(x)` inside prose or a quoted example from counting as a
 * write, and every real write site in this file is bare code.
 */
export function stripCommentsAndStrings(source: string): string {
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

/**
 * The one write `anonymize.ts` makes through a variable: the registry's plain
 * deletes (`deleteRegisteredPersonRows`), which stand for every row of
 * `erasedPersonRowDeletes()`. They count as written only while a sweep calls
 * the function, so a dropped call is a dropped write here too.
 */
export const REGISTRY_WRITE = "registeredTable";
export const REGISTRY_DELETES_CALL = /(?<!function )\bdeleteRegisteredPersonRows\(\s*tx\b/;

export function registryDeletesRun(strippedSource: string): boolean {
  const calls = [...strippedSource.matchAll(new RegExp(REGISTRY_DELETES_CALL, "g"))];
  // Exactly one call, unconditionally in a sweep's own body: a second call site
  // or one inside a branch is a write this file can no longer place.
  const [call] = calls;
  if (calls.length !== 1 || !call) return false;
  const line = strippedSource.slice(strippedSource.lastIndexOf("\n", call.index) + 1, call.index);
  return line === "  await " && sweepContaining(strippedSource, call.index) !== null;
}

/** Whether `index` is inside `deleteRegisteredPersonRows`, the one place the variable write is allowed. */
export function inRegistryDeleteFunction(strippedSource: string, index: number): boolean {
  const start = strippedSource.search(/^async function deleteRegisteredPersonRows\(/m);
  return start >= 0 && index > start && index < strippedSource.indexOf("\n}\n", start);
}

/** The `scrub*` sweep whose body holds `index`, or null. */
export function sweepContaining(strippedSource: string, index: number): string | null {
  for (const match of strippedSource.matchAll(/^async function (scrub\w+)\(/gm)) {
    const start = match.index ?? 0;
    const end = strippedSource.indexOf("\n}\n", start);
    if (index > start && index < end) return match[1] as string;
  }
  return null;
}
