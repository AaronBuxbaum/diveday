/** Compare a saved selector prediction with full-suite observations, never changing the gate. */
import { reportTests } from "./e2e-budget-report.mjs";

export function selectionSnapshot(
  selection,
  { sha = null, createdAt = new Date().toISOString(), agent = null } = {},
) {
  return {
    version: 1,
    sha,
    createdAt,
    agent,
    base: selection?.base ?? null,
    changed: selection?.changed ?? [],
    available: selection !== null && selection !== undefined,
    strong: selection
      ? Object.fromEntries([...selection.strong].map(([key, why]) => [key, [...why]]))
      : {},
    reach: selection
      ? Object.fromEntries([...selection.reach].map(([key, why]) => [key, [...why]]))
      : {},
    fallbacks: selection?.fallbacks ?? (selection ? [] : ["selection-unavailable"]),
  };
}

// JSON reporter paths are relative to testDir, whereas selectors use repository paths.
export function specPath(file) {
  const normalized = file.replaceAll("\\", "/");
  const at = normalized.lastIndexOf("/e2e/");
  if (at >= 0) return normalized.slice(at + 1);
  return normalized.startsWith("e2e/") ? normalized : `e2e/${normalized}`;
}

function matches(keys, file, line) {
  return keys.has(file) || keys.has(`${file}:${line}`);
}

function identity(row) {
  return JSON.stringify([
    specPath(row.file),
    row.line,
    row.title,
    row.test.projectName ?? row.test.projectId,
  ]);
}

/** A retry passing is a flake observation; even repeated failures do not establish change causality. */
export function compareShadow(snapshot, report, { retryReport, sha = null } = {}) {
  if (snapshot.version !== 1) throw new Error("Unsupported impact snapshot version");
  if (sha && snapshot.sha && sha !== snapshot.sha)
    throw new Error("Impact snapshot SHA does not match report checkout");
  const strong = new Set(Object.keys(snapshot.strong));
  const all = new Set([...strong, ...Object.keys(snapshot.reach)]);
  const agent = snapshot.agent ? new Set(snapshot.agent.specs) : null;
  const retries = new Map(reportTests(retryReport ?? {}).map((row) => [identity(row), row]));
  const rows = reportTests(report).map((row) => {
    const file = specPath(row.file);
    const attempts = [
      ...(row.test.results ?? []),
      ...(retries.get(identity(row))?.test.results ?? []),
    ];
    const executed = attempts.filter(
      (result) => !["skipped", "interrupted"].includes(result.status),
    );
    const failed = executed.filter((result) => ["failed", "timedOut"].includes(result.status));
    const passed = executed.some((result) => result.status === "passed");
    const unexpected = row.test.status === "unexpected";
    const unexpectedPass = unexpected && row.test.expectedStatus === "failed" && passed;
    const outcome = unexpectedPass
      ? "unexpected-pass"
      : row.test.status === "flaky" || (unexpected && failed.length > 0 && passed)
        ? "retry-recovered"
        : unexpected && failed.length > 0
          ? failed.length > 1
            ? "repeated-failure"
            : "single-failure"
          : executed.length === 0
            ? "not-executed"
            : "expected";
    return {
      file,
      line: row.line,
      title: row.title,
      project: row.test.projectName ?? row.test.projectId ?? "",
      strong: snapshot.available ? matches(strong, file, row.line) : null,
      agentSelected: agent ? matches(agent, file, row.line) : null,
      selected: snapshot.available ? matches(all, file, row.line) : null,
      outcome,
      attempts: executed.length,
      durationMs: attempts.reduce((sum, attempt) => sum + (attempt.duration ?? 0), 0),
    };
  });
  const failures = rows.filter((row) =>
    ["single-failure", "repeated-failure", "unexpected-pass"].includes(row.outcome),
  );
  return {
    version: 1,
    sha: snapshot.sha,
    base: snapshot.base,
    available: snapshot.available,
    fallbacks: snapshot.fallbacks,
    scope:
      "This report shard only; durations sum test attempts, not wall-clock savings. Failures are candidates, not proven selector misses.",
    reportErrors: (report.errors ?? []).length,
    counts: {
      observed: rows.length,
      executed: rows.filter((row) => row.outcome !== "not-executed").length,
      selected: rows.filter((row) => row.selected === true).length,
      deferred: rows.filter((row) => row.selected === false).length,
      unresolvedFailures: failures.length,
      unexpectedPasses: rows.filter((row) => row.outcome === "unexpected-pass").length,
      agentDeferredFailures: failures.filter((row) => row.agentSelected === false).length,
      deferredFailures: failures.filter((row) => row.selected === false).length,
      outsideStrongFailures: failures.filter((row) => row.strong === false).length,
      retryRecovered: rows.filter((row) => row.outcome === "retry-recovered").length,
    },
    estimatedAgentMs: snapshot.agent?.estimatedMs ?? null,
    durationMs: {
      agentSelected: agent
        ? rows
            .filter((row) => row.agentSelected === true)
            .reduce((sum, row) => sum + row.durationMs, 0)
        : null,
      observed: rows.reduce((sum, row) => sum + row.durationMs, 0),
      selected: rows
        .filter((row) => row.selected === true)
        .reduce((sum, row) => sum + row.durationMs, 0),
      deferred: rows
        .filter((row) => row.selected === false)
        .reduce((sum, row) => sum + row.durationMs, 0),
    },
    observations: rows,
  };
}

export function shadowSummary(report) {
  const { counts } = report;
  const lines = [
    "### Test-impact shadow (full functional shard)",
    report.available
      ? `${counts.selected} selected; ${counts.deferred} deferred; ${counts.executed}/${counts.observed} observed tests executed.`
      : "Selection unavailable; recall cannot be measured.",
    `${counts.deferredFailures} unresolved failure candidates outside full selection; ${counts.outsideStrongFailures} outside strong selection; ${counts.agentDeferredFailures} outside agent selection; ${counts.retryRecovered} retry-recovered observations.`,
    "These are observations, not proven change-caused misses. Full CI remains the gate. Attempt duration sums are not wall-clock savings.",
  ];
  if (report.reportErrors)
    lines.push(
      `${report.reportErrors} report-level error(s): this shard's observations may be incomplete.`,
    );
  for (const row of report.observations.filter(
    (entry) =>
      entry.selected === false &&
      ["single-failure", "repeated-failure", "unexpected-pass"].includes(entry.outcome),
  )) {
    lines.push(`- \`${row.file}:${row.line}\` (${row.outcome})`);
  }
  return `${lines.join("\n\n")}\n`;
}
