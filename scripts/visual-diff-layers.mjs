#!/usr/bin/env node
// Compares two commits' *captures* to each other, not to a baseline: which
// surfaces did the commits between them move? (issue #1949)
//
// `pnpm visual:report` answers "what did reg-suit say about this commit", and
// reg-suit compares against the fork point from `main` (ADR
// 20260919-stack-ci-cancels-superseded-layers). On a stacked pull request that
// report is the whole stack's delta: on #1948, layer 4 of four, it listed 336
// changed surfaces of which the layer itself had moved 4. This reads the
// layer's own slice instead, by comparing the `actual/` captures published for
// this layer's head and for the layer below's head.
//
// It costs almost nothing. S3 answers a `HEAD` with the object's ETag, so the
// whole suite compares without downloading an image; only the surfaces whose
// bytes differ are fetched (with `--download`), and those are diffed pixel by
// pixel to say how much moved and where.
//
// A reading aid, never a gate: it is not part of `pnpm check` or CI. Both
// commits must have published captures (every stack layer runs CI, ADR
// 20261003-every-stack-layer-runs-ci); a commit that published nothing is
// reported as such rather than compared.
//
//   node scripts/visual-diff-layers.mjs --from <layer-below-sha> --to <layer-sha>
//   node scripts/visual-diff-layers.mjs --from <sha> --to <sha> --download
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

import { DEFAULT_BUCKET, fetchFromBucket, objectUrl, readPngSize } from "./visual-report-lib.mjs";

/**
 * Sorts every capture name into one bucket from two `name -> etag` maps. An
 * etag of `null` means the HEAD failed for that commit, which is "unknown",
 * never "unchanged".
 */
export function compareCaptures(fromEtags, toEtags) {
  const result = { same: [], differs: [], onlyFrom: [], onlyTo: [], unknown: [] };
  const names = [...new Set([...fromEtags.keys(), ...toEtags.keys()])].sort();
  for (const name of names) {
    const inFrom = fromEtags.has(name);
    const inTo = toEtags.has(name);
    if (!inTo) result.onlyFrom.push(name);
    else if (!inFrom) result.onlyTo.push(name);
    else {
      const a = fromEtags.get(name);
      const b = toEtags.get(name);
      if (a === null || b === null) result.unknown.push(name);
      else if (a === b) result.same.push(name);
      else result.differs.push(name);
    }
  }
  return result;
}

/**
 * How two same-sized RGBA buffers differ: the count of pixels with any channel
 * apart, the largest channel delta, and the bounding box of the change. `null`
 * for a geometry change, where a pixel count would compare unrelated rows.
 */
export function pixelDifference(a, b, { width, height }) {
  if (a.length !== b.length || a.length !== width * height * 4) return null;
  let pixels = 0;
  let maxDelta = 0;
  let top = height;
  let left = width;
  let bottom = -1;
  let right = -1;
  for (let index = 0; index < a.length; index += 4) {
    let delta = 0;
    for (let channel = 0; channel < 4; channel += 1) {
      delta = Math.max(delta, Math.abs(a[index + channel] - b[index + channel]));
    }
    if (delta === 0) continue;
    pixels += 1;
    maxDelta = Math.max(maxDelta, delta);
    const pixel = index / 4;
    const y = Math.floor(pixel / width);
    const x = pixel % width;
    top = Math.min(top, y);
    bottom = Math.max(bottom, y);
    left = Math.min(left, x);
    right = Math.max(right, x);
  }
  return {
    pixels,
    maxDelta,
    box: pixels === 0 ? null : { top, left, bottom, right },
  };
}

/** One line per differing capture, for the report. */
export function describeDifference(name, { fromSize, toSize, diff }) {
  if (!fromSize || !toSize) return `- \`${name}\`: bytes differ`;
  if (fromSize.width !== toSize.width || fromSize.height !== toSize.height) {
    const delta = toSize.height - fromSize.height;
    return `- \`${name}\`: geometry ${fromSize.width}×${fromSize.height} → ${toSize.width}×${toSize.height} (${delta >= 0 ? "+" : ""}${delta}px tall)`;
  }
  if (!diff) return `- \`${name}\`: bytes differ`;
  if (diff.pixels === 0) return `- \`${name}\`: bytes differ, pixels identical (encoding only)`;
  const { top, left, bottom, right } = diff.box;
  return `- \`${name}\`: ${diff.pixels} pixels, max channel delta ${diff.maxDelta}/255, within x ${left}–${right}, y ${top}–${bottom}`;
}

function parseArgs(argv) {
  const args = {
    bucket: DEFAULT_BUCKET,
    out: ".reg-report/layers",
    download: false,
    concurrency: 24,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--from") args.from = argv[++i];
    else if (arg === "--to") args.to = argv[++i];
    else if (arg === "--bucket") args.bucket = argv[++i];
    else if (arg === "--out") args.out = argv[++i];
    else if (arg === "--download") args.download = true;
    else if (arg === "--concurrency") args.concurrency = Number(argv[++i]) || args.concurrency;
    else {
      console.error(`visual-diff-layers: unknown argument ${arg}`);
      args.bad = true;
    }
  }
  return args;
}

async function captureNames(bucket, commit) {
  const fetched = await fetchFromBucket(bucket, `${commit}/out.json`);
  if (!fetched.ok) return null;
  const report = JSON.parse(fetched.body.toString("utf8"));
  const names = Array.isArray(report.actualItems) ? report.actualItems : [];
  return { names, dir: report.actualDir || "actual" };
}

async function headEtag(url) {
  try {
    const res = await fetch(url, { method: "HEAD" });
    return res.ok ? (res.headers.get("etag") ?? null) : null;
  } catch {
    return null;
  }
}

async function etagsFor(bucket, commit, { names, dir }, concurrency) {
  const etags = new Map();
  let next = 0;
  const worker = async () => {
    while (next < names.length) {
      const name = names[next];
      next += 1;
      etags.set(name, await headEtag(objectUrl(bucket, `${commit}/${dir}/${name}`)));
    }
  };
  await Promise.all(Array.from({ length: concurrency }, worker));
  return etags;
}

async function rawPixels(bytes) {
  const { default: sharp } = await import("sharp");
  const { data, info } = await sharp(bytes)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { data, size: { width: info.width, height: info.height } };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.bad || !args.from || !args.to) {
    console.error(
      "Usage: node scripts/visual-diff-layers.mjs --from <sha> --to <sha> [--download] [--bucket <name>] [--out <dir>]",
    );
    process.exit(1);
  }
  const [from, to] = await Promise.all([
    captureNames(args.bucket, args.from),
    captureNames(args.bucket, args.to),
  ]);
  for (const [commit, published] of [
    [args.from, from],
    [args.to, to],
  ]) {
    if (!published) {
      console.error(
        `visual-diff-layers: ${commit} published no out.json to "${args.bucket}", so there are no captures to compare. Its visual job did not run or did not finish.`,
      );
      process.exit(1);
    }
  }

  const [fromEtags, toEtags] = await Promise.all([
    etagsFor(args.bucket, args.from, from, args.concurrency),
    etagsFor(args.bucket, args.to, to, args.concurrency),
  ]);
  const result = compareCaptures(fromEtags, toEtags);
  const short = (sha) => sha.slice(0, 7);
  const lines = [
    `# Captures moved between ${short(args.from)} and ${short(args.to)}`,
    "",
    `Compared ${result.same.length + result.differs.length} capture(s) by ETag: ${result.differs.length} differ, ${result.same.length} identical, ${result.onlyTo.length} only at ${short(args.to)}, ${result.onlyFrom.length} only at ${short(args.from)}, ${result.unknown.length} unreadable.`,
    "",
  ];

  const outDir = path.join(args.out, `${short(args.from)}-${short(args.to)}`);
  if (result.differs.length > 0) lines.push("## Differ", "");
  for (const name of result.differs) {
    if (!args.download) {
      lines.push(`- \`${name}\``);
      continue;
    }
    const [a, b] = await Promise.all([
      fetchFromBucket(args.bucket, `${args.from}/${from.dir}/${name}`),
      fetchFromBucket(args.bucket, `${args.to}/${to.dir}/${name}`),
    ]);
    if (!a.ok || !b.ok) {
      lines.push(`- \`${name}\`: bytes differ (download failed)`);
      continue;
    }
    mkdirSync(outDir, { recursive: true });
    const base = name.replace(/\.png$/, "");
    writeFileSync(path.join(outDir, `${base}.from.png`), a.body);
    writeFileSync(path.join(outDir, `${base}.to.png`), b.body);
    const fromSize = readPngSize(a.body);
    const toSize = readPngSize(b.body);
    let diff = null;
    if (
      fromSize &&
      toSize &&
      fromSize.width === toSize.width &&
      fromSize.height === toSize.height
    ) {
      const [pa, pb] = await Promise.all([rawPixels(a.body), rawPixels(b.body)]);
      diff = pixelDifference(pa.data, pb.data, pa.size);
    }
    lines.push(describeDifference(name, { fromSize, toSize, diff }));
  }
  if (result.differs.length > 0) lines.push("");
  for (const [title, list] of [
    [`Only at ${short(args.to)} (new captures)`, result.onlyTo],
    [`Only at ${short(args.from)} (captures removed)`, result.onlyFrom],
    ["Unreadable (HEAD failed; not known to be unchanged)", result.unknown],
  ]) {
    if (list.length === 0) continue;
    lines.push(`## ${title}`, "", ...list.map((name) => `- \`${name}\``), "");
  }
  if (args.download && result.differs.length > 0) {
    lines.push(
      `Both images of each differing capture are in \`${outDir}/\` as \`<name>.from.png\` and \`<name>.to.png\`.`,
    );
  }
  console.log(lines.join("\n"));
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().catch((err) => {
    console.error(`visual-diff-layers: ${err.message}`);
    process.exit(1);
  });
}
