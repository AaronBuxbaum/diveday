// "The layer below is red": said loudly, with the layer's branch, by `pnpm verify:push`.
//
// `verify:push` already replays the base's red test files (`scripts/base-ci.mjs`) and stamps only
// when they pass here, so a layer that carries the fix pushes. Two gaps were left. The gate said
// "base CI: … is red" as one line among many, and threads kept stacking work on a red layer
// instead of fixing it at the bottom (findings 2026-10-22: the same tests repeat red up a stack,
// 2918/2912, 2929/2932). And the base can finish red *after* the stamp: a base still running is
// a note, not a refusal, so a stamp taken then replayed nothing.
//
// Everything that reads GitHub fails open: no `gh`, no network, no pull request → no warning.

/** Red jobs `verify:push` answers with its own steps: a stamp means they passed here. */
const ANSWERED_HERE = /^(?:Lint|Typecheck|Repository safeguards)$/;

/** `origin/<branch>` → `<branch>`; anything else unchanged. */
export function branchOf(ref) {
  return (ref ?? "").replace(/^origin\//, "");
}

/**
 * What of the base's red this push has not answered, or null when nothing is left.
 *
 * `verdict` is `scripts/base-ci.mjs`'s (`{ red, files, specs, unnamed }`, or `{ unknown }`);
 * `touched` the files this branch changes against the base; `stamp` the push's `verify:push`
 * stamp (its `baseCi.ran` passed here; its `baseCi.red` is what the base showed then), or null
 * before a run. A red test file this branch edits is taken as the fix in progress; a red job
 * that names no file is answered only when the stamp saw it (the author named its files with
 * `--base-red`); Lint, Typecheck and Repository safeguards only when there is a stamp at all.
 */
export function unansweredRed(verdict, { touched = [], stamp = null } = {}) {
  if (!verdict || verdict.unknown || !verdict.red?.length) return null;
  const ran = new Set(stamp?.baseCi?.ran ?? []);
  const seen = new Set(stamp?.baseCi?.red ?? []);
  const edited = new Set(touched);
  const files = [...(verdict.files ?? []), ...(verdict.specs ?? [])].filter(
    (file) => !ran.has(file) && !edited.has(file),
  );
  const jobs = (verdict.unnamed ?? []).filter((job) => !seen.has(job));
  if (!stamp) jobs.push(...verdict.red.filter((job) => ANSWERED_HERE.test(job)));
  if (files.length === 0 && jobs.length === 0) return null;
  return { files, jobs };
}

/**
 * The loud lines. `base` is the layer below's branch (`main` for a bottom layer), `pull` its
 * open pull request number or null, `red` {@link unansweredRed}'s answer and `when` "push" (after a
 * stamp) or "verify" (before the run).
 */
export function redBelowMessage({ base, pull = null, red, when }) {
  const layer = base === "main" ? "`main`" : `\`${base}\`${pull ? ` (#${pull})` : ""}`;
  const what = [...red.files, ...red.jobs.map((job) => `the ${job} job`)].join(", ");
  const head = `THE LAYER BELOW IS RED: ${layer} failed on ${what}, none of which this branch edits.`;
  const fix =
    base === "main"
      ? "Fix main first (whoever broke it, through the coordinator), then merge it up"
      : `Fix it in ${layer} first, where it broke (its owner, through the coordinator), merge that layer up once its CI is green (\`pnpm stack:sync\`)`;
  const tail =
    when === "push"
      ? `This commit's stamp did not run them, so this push is a red CI run here and on every layer above. ${fix}; or, if this layer carries the fix, run \`pnpm verify:push --quick\` again, which replays them and stamps only if they pass.`
      : `They run here now, and this gate goes red unless this layer carries the fix. ${fix}, rather than stacking more work on red.`;
  return `${head} ${tail}`;
}
