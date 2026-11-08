// HTTP, database and filesystem edges are not necessarily JavaScript imports.
// Until shadow measurements justify narrower boundaries, uncertainty expands selection.
const GLOBAL =
  /^(?:package\.json$|pnpm-lock\.yaml$|pnpm-workspace\.yaml$|(?:next|playwright|tsconfig)[^/]*\.|drizzle\/|src\/db\/|src\/app\/api\/|src\/lib\/(?:auth|session)[^/]*|src\/(?:middleware|proxy)\.|e2e\/(?:fixtures|global-setup|db)[^/]*\.)/;
const NON_RUNTIME =
  /^(?:docs\/|scripts\/|infra\/|src\/test\/|\.github\/|\.claude\/|\.agents\/)|\.md$|\.test\.(?:ts|tsx|mjs|mts|js)$/;
const RUNTIME = /^(?:src\/|e2e\/|public\/)/;

/** Report why a static graph cannot safely narrow this change. */
export function browserRuntimeInput(file) {
  return RUNTIME.test(file) && !NON_RUNTIME.test(file);
}

export function browserFallbacks({ changed, selected, existing = () => true }) {
  const reasons = [];
  for (const file of changed) {
    if (NON_RUNTIME.test(file)) continue;
    if (GLOBAL.test(file)) reasons.push(`global browser input: ${file}`);
    else if (file.startsWith("public/")) reasons.push(`unmodelled browser asset: ${file}`);
    else if (!existing(file)) reasons.push(`deleted or unreadable browser input: ${file}`);
    else if (!RUNTIME.test(file)) reasons.push(`unmodelled input: ${file}`);
  }
  if (changed.some((file) => RUNTIME.test(file) && !NON_RUNTIME.test(file)) && selected === 0)
    reasons.push("runtime changes have no mapped browser coverage");
  return reasons;
}

/** A broad fallback is explicit, not a deceptively narrow green smoke run. */
export function expandBrowserFallback(selection, specs, reasons, excluded = () => false) {
  if (reasons.length === 0) return selection;
  for (const spec of specs.keys()) {
    if (excluded(spec) || selection.strong.has(spec)) continue;
    selection.reach.set(spec, new Set([`conservative fallback: ${reasons[0]}`]));
    if (!selection.rank.has(spec)) selection.rank.set(spec, selection.rank.size);
  }
  return selection;
}
