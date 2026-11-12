/** Mode/runner strata and robust multi-run calibration. Legacy maps stay a fallback. */
export function profileKey(metadata) {
  return `${metadata.runner}|node${metadata.nodeMajor}|coverage:${metadata.coverage}`;
}

export function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/** The share of the held-out run's files the training runs must have measured. */
const MINIMUM_SUITE_OVERLAP = 0.9;

/** A profile is adopted only after at least three distinct, complete successful runs. */
export function calibrateProfiles(inputs, minimumRuns = 3) {
  const runs = new Map();
  for (const input of inputs) {
    if (input.version !== 2 || !input.metadata || !input.durations) continue;
    const { metadata } = input;
    if (!metadata.runId || !metadata.sha || metadata.success !== true) continue;
    if (!Number.isInteger(metadata.files) || metadata.files !== Object.keys(input.durations).length)
      continue;
    if (
      !Number.isInteger(metadata.shards) ||
      metadata.shards < 1 ||
      !Number.isInteger(metadata.shard) ||
      metadata.shard < 1 ||
      metadata.shard > metadata.shards
    )
      throw new Error("invalid shard metadata");
    const key = `${profileKey(metadata)}|${metadata.runId}|${metadata.sha}`;
    const run = runs.get(key) ?? { metadata, shards: new Map() };
    if (run.metadata.shards !== metadata.shards) throw new Error("inconsistent shard metadata");
    if (run.shards.has(metadata.shard))
      throw new Error(`duplicate duration shard ${key}/${metadata.shard}`);
    run.shards.set(metadata.shard, input.durations);
    runs.set(key, run);
  }
  const groups = new Map();
  for (const { metadata, shards } of runs.values()) {
    if (
      shards.size !== metadata.shards ||
      !Array.from({ length: metadata.shards }, (_, i) => shards.has(i + 1)).every(Boolean)
    )
      continue;
    const durations = {};
    for (const shard of shards.values())
      for (const [file, cost] of Object.entries(shard)) {
        if (file in durations) throw new Error(`test appears twice in complete run: ${file}`);
        if (!Number.isFinite(cost) || cost < 0) throw new Error(`invalid duration: ${file}`);
        durations[file] = cost;
      }
    const key = profileKey(metadata);
    const group = groups.get(key) ?? [];
    group.push({ metadata, durations });
    groups.set(key, group);
  }
  const profiles = {};
  for (const [key, group] of groups) {
    if (group.length < minimumRuns) continue;
    const ordered = [...group].sort((a, b) =>
      b.metadata.createdAt.localeCompare(a.metadata.createdAt),
    );
    const newest = ordered[0];
    const training = ordered.slice(1);
    const observations = new Map();
    for (const run of training)
      for (const [file, ms] of Object.entries(run.durations)) {
        const values = observations.get(file) ?? [];
        values.push(ms);
        observations.set(file, values);
      }
    const durations = Object.fromEntries(
      [...observations]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([file, values]) => [file, Math.round(median(values))]),
    );
    // The suite moves between main runs (files are added every day), so demanding identical file
    // sets would leave every stratum uncalibrated forever. Adopt a profile when the held-out run's
    // files are nearly all measured by the training runs; the sequencer scales an estimate for
    // the few it does not know (src/test/shard-sequencer.ts).
    const suite = Object.keys(newest.durations).sort();
    const common = suite.filter((file) => observations.has(file));
    if (common.length < suite.length * MINIMUM_SUITE_OVERLAP) continue;
    const pick = (map) => Object.fromEntries(common.map((file) => [file, map[file]]));
    const proposed = replayWeights(pick(durations), pick(newest.durations), newest.metadata.shards);
    const baseline = replayWeights(
      pick(training[0].durations),
      pick(newest.durations),
      newest.metadata.shards,
    );
    // A noisy stratum is reportable, not a reason to adopt a worse held-out deal.
    if (common.length === 0 || proposed.criticalPathMs > baseline.criticalPathMs) continue;
    profiles[key] = {
      sourceSha: training[0].metadata.sha,
      measuredAt: training[0].metadata.createdAt,
      trainingShas: training.map((run) => run.metadata.sha),
      validationSha: newest.metadata.sha,
      runs: group.map((run) => run.metadata.runId),
      durations,
      validation: {
        heldOutRun: newest.metadata.runId,
        commonFiles: common.length,
        measuredFiles: Object.keys(newest.durations).length,
        proposed,
        latestRunBaseline: baseline,
      },
    };
  }
  return { version: 2, profiles };
}

/** Replay a deal against a held-out run; bytes of JSON are not execution measurements. */
export function replayWeights(weights, actual, shards = 4) {
  const bins = Array.from({ length: shards }, () => ({ predicted: 0, actual: 0 }));
  for (const [file, ms] of Object.entries(weights).sort(
    ([a, x], [b, y]) => y - x || a.localeCompare(b),
  )) {
    const bin = bins.reduce((best, next) => (next.predicted < best.predicted ? next : best));
    bin.predicted += ms;
    bin.actual += actual[file] ?? 0;
  }
  return {
    bins,
    criticalPathMs: Math.max(...bins.map((bin) => bin.actual)),
    totalWorkMs: bins.reduce((sum, bin) => sum + bin.actual, 0),
    worstBinErrorMs: Math.max(...bins.map((bin) => Math.abs(bin.actual - bin.predicted))),
  };
}
