// What `check-repo.mjs` leaves behind on CI: the failing guards by name, in the job summary and
// as a JSON artifact, so a catch rate per guard can be read across runs. A failed run said only
// "Repository safeguards" in its check name, and history before 2026-10-07 was squashed, so no
// guard's value could be measured (test review 2026-10-14).

/** The JSON record of one run: every guard's name and whether it passed. */
export function checkRepoRecord(results, { sha = "", ref = "", at = new Date() } = {}) {
  return {
    sha,
    ref,
    at: at.toISOString(),
    failed: results.filter((result) => result.code !== 0).map((result) => result.label),
    passed: results.filter((result) => result.code === 0).map((result) => result.label),
  };
}

/** The job-summary Markdown: the failing guards, each with its first line of output. */
export function checkRepoSummary(results) {
  const failed = results.filter((result) => result.code !== 0);
  if (failed.length === 0) return `check:repo: all ${results.length} guards passed.\n`;
  const lines = [`### check:repo: ${failed.length} of ${results.length} guards failed`, ""];
  for (const result of failed) {
    const first = `${result.stderr}\n${result.stdout}`.trim().split("\n")[0] ?? "";
    lines.push(`- \`${result.label}\` (${result.scriptFile}): ${first.slice(0, 200)}`);
  }
  return `${lines.join("\n")}\n`;
}
