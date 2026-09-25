#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import sharp from "sharp";
import { CHECKS, censusNearMisses, clusterKey, settledEntryFor } from "./pixel-probe/analyze.mjs";

/**
 * **Reads what the pixel probe wrote and turns it into something to audit.**
 *
 *   node scripts/pixel-probe-report.mjs                 # e2e/pixel-probe/REPORT.md + clusters.json
 *   node scripts/pixel-probe-report.mjs --tiles <name>  # 1:1 tiles of one capture's light PNGs
 *   node scripts/pixel-probe-report.mjs --atlas         # the state atlas as contact sheets
 *
 * The report groups flags two ways. **By cluster** — check, component
 * signature and the signature of the container it sits in — so one shared
 * component's flaw is one line listing every surface it reaches, which is the
 * order fixes should land in. **By surface family**, so an auditor handed
 * "the departure" can find every capture of it, the flags on each, and the one
 * command that re-probes just that capture.
 *
 * Flags `scripts/pixel-probe-settled.json` has judged right are listed as
 * settled with their reason, never dropped silently. Records the probe could
 * not finish are counted as skipped, so "no findings" and "never ran" do not
 * look alike.
 *
 * `--tiles` exists because a whole-page capture viewed whole is scaled until a
 * 4px offset disappears. It cuts `e2e/screenshots/<name>-light-vw-*.png` into
 * 1:1 tiles (390×1,560 at phone width, 1,280×880 at desktop), skipping any
 * tile byte-identical to one already cut from a sibling capture — the same
 * header, twice, is one tile to read.
 */

const ROOT = process.cwd();
const OUT = path.join(ROOT, "e2e", "pixel-probe");
const CAPTURES = path.join(OUT, "captures");
const SETTLED = path.join(ROOT, "scripts", "pixel-probe-settled.json");
const ROUTES = path.join(ROOT, "scripts", "route-coverage.json");
const SCREENSHOTS = path.join(ROOT, "e2e", "screenshots");

/** The nine audit families (the brief's split), by route pattern. */
export const FAMILIES = [
  {
    key: "public",
    title: "Public site and sign-in",
    match: (route) =>
      route === "/" ||
      /^\/(about|product|pricing|privacy|terms|status|switching|dive|demo|sign-in|onboard|forgot-password)(\/|$)/.test(
        route,
      ),
  },
  { key: "diver", title: "The diver's shop", match: (route) => route.startsWith("/s/") },
  {
    key: "token",
    title: "Token pages and offline",
    match: (route) =>
      /^\/(ready|waivers|recap|verify|reset-password|invite|claim|gift|shelf|board|check-in|confirm-contact|unsubscribe|offline-manifest)(\/|$)/.test(
        route,
      ),
  },
  {
    key: "staff-day",
    title: "The staff day",
    match: (route) =>
      route === "/shop/[shopSlug]" ||
      /^\/shop\/\[shopSlug\]\/(check-in|bookings|calls|inbox|requests|schedule|staffing)(\/|$)/.test(
        route,
      ),
  },
  {
    key: "departure",
    title: "The departure",
    match: (route) => /^\/shop\/\[shopSlug\]\/(trips|print)(\/|$)/.test(route),
  },
  {
    key: "records",
    title: "Records",
    match: (route) =>
      /^\/shop\/\[shopSlug\]\/(divers|courses|dive-sites|gear|waivers|reviews)(\/|$)/.test(route),
  },
  {
    key: "money",
    title: "Money and reports",
    match: (route) => /^\/shop\/\[shopSlug\]\/(orders|promos|reports)(\/|$)/.test(route),
  },
  {
    key: "settings",
    title: "Settings",
    match: (route) => /^\/shop\/\[shopSlug\]\/settings(\/|$)/.test(route),
  },
  { key: "chrome", title: "Chrome, overlays and the state atlas", match: () => false },
];

/** The route pattern a URL path renders, from the route ledger's keys. */
export function routeForPath(urlPath, routes) {
  const [withoutQuery] = String(urlPath || "").split(/[?#]/, 1);
  const segments = withoutQuery.split("/").filter(Boolean);
  const matches = routes.filter((pattern) => {
    const wanted = pattern.split("/").filter(Boolean);
    if (wanted.length !== segments.length) return false;
    return wanted.every((part, index) => part.startsWith("[") || part === segments[index]);
  });
  // The most literal pattern wins: `/switching/spreadsheet` over `/switching/[competitor]`.
  matches.sort(
    (a, b) => (a.match(/\[/g) || []).length - (b.match(/\[/g) || []).length || b.length - a.length,
  );
  return matches[0] ?? null;
}

export function familyForRoute(route) {
  if (!route) return FAMILIES.at(-1);
  return FAMILIES.find((family) => family.match(route)) ?? FAMILIES.at(-1);
}

/** A regex that matches exactly this test's title under Playwright's `--grep`. */
export function grepFor(titlePath) {
  const parts = (titlePath || []).filter(
    (part, index) => !(index === 0 && /\.spec\.ts$/.test(part)),
  );
  return parts.join(" ").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** A shell-safe re-run command for one capture's test. */
export function rerunCommand(record) {
  const file = record.testFile ? path.relative(ROOT, record.testFile) : "e2e/visual.spec.ts";
  if (record.source === "dev") {
    return `node scripts/screenshot.mjs ${record.path || "<path>"} --probe`;
  }
  const quoted = `'${grepFor(record.titlePath).replace(/'/g, "'\\''")}'`;
  return `PIXEL_PROBE=1 pnpm e2e:run ${file} --grep ${quoted} --reporter=line`;
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

export function loadRecords(dir = CAPTURES) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((file) => file.endsWith(".json"))
    .sort()
    .map((file) => ({
      file,
      ...readJson(path.join(dir, file), { probed: false, skipped: "unreadable" }),
    }));
}

/** Capture name → route, from the ledger's `visual` lists. */
export function captureRoutes(ledger) {
  const map = new Map();
  for (const [route, entry] of Object.entries(ledger)) {
    if (route.startsWith("//")) continue;
    for (const name of entry.visual || []) if (!map.has(name)) map.set(name, route);
  }
  return map;
}

/** Everything the report says, as data — `clusters.json`, and what the tests read. */
export function buildReport(records, { settled = [], ledger = {} } = {}) {
  const routes = Object.keys(ledger).filter((key) => !key.startsWith("//"));
  const byCapture = captureRoutes(ledger);
  const surfaces = new Map();
  const clusters = new Map();
  const settledHits = new Map();
  const census = { families: {}, rows: {} };
  const skipped = [];
  let probed = 0;
  for (const record of records) {
    const baseName = String(record.capture || "").replace(/-es-ES$/, "");
    const route = byCapture.get(baseName) ?? routeForPath(record.path, routes);
    const family = familyForRoute(route);
    const surfaceKey = record.capture || record.file;
    if (!surfaces.has(surfaceKey)) {
      surfaces.set(surfaceKey, {
        capture: record.capture,
        route,
        family: family.key,
        path: record.path,
        rerun: rerunCommand(record),
        widths: [],
        flags: {},
        skipped: [],
      });
    }
    const surface = surfaces.get(surfaceKey);
    surface.widths.push(`${record.sweep ? "sweep " : ""}${record.width}`);
    if (!record.probed) {
      skipped.push({ capture: record.capture, width: record.width, why: record.skipped });
      surface.skipped.push(`${record.width}: ${record.skipped}`);
      continue;
    }
    probed += 1;
    for (const flag of record.flags || []) {
      const entry = settledEntryFor(flag, settled);
      const key = clusterKey(flag);
      const target = entry ? settledHits : clusters;
      if (!target.has(key)) {
        target.set(key, {
          check: flag.check,
          severity: flag.severity,
          sig: flag.sig,
          csig: flag.csig,
          cls: flag.cls,
          msg: flag.msg,
          settled: entry,
          occurrences: [],
          captures: new Set(),
          families: new Set(),
        });
      }
      const cluster = target.get(key);
      if (flag.severity < cluster.severity) cluster.severity = flag.severity;
      cluster.occurrences.push({
        capture: record.capture,
        width: record.width,
        sweep: record.sweep,
        state: flag.state,
        label: flag.label,
        msg: flag.msg,
        crop: flag.crop,
        measure: flag.measure,
      });
      cluster.captures.add(record.capture);
      cluster.families.add(family.key);
      if (!entry) surface.flags[flag.check] = (surface.flags[flag.check] || 0) + 1;
    }
    if (record.census) {
      for (const [familyName, sigs] of Object.entries(record.census.families || {})) {
        census.families[familyName] ||= {};
        for (const [sig, entry] of Object.entries(sigs)) {
          if (!census.families[familyName][sig]) {
            census.families[familyName][sig] = {
              h: {},
              pl: {},
              pt: {},
              r: {},
              fs: {},
              cls: entry.cls,
              n: 0,
              captures: [],
            };
          }
          const merged = census.families[familyName][sig];
          merged.n += entry.n;
          if (!merged.captures.includes(record.capture) && merged.captures.length < 12) {
            merged.captures.push(record.capture);
          }
          for (const metric of ["h", "pl", "pt", "r", "fs"]) {
            for (const [value, count] of Object.entries(entry[metric] || {})) {
              merged[metric][value] = (merged[metric][value] || 0) + count;
            }
          }
        }
      }
      for (const [sig, row] of Object.entries(record.census.rows || {})) {
        if (!census.rows[sig])
          census.rows[sig] = { insets: {}, host: row.host, n: 0, captures: [] };
        const merged = census.rows[sig];
        merged.n += row.n;
        if (!merged.captures.includes(record.capture) && merged.captures.length < 12) {
          merged.captures.push(record.capture);
        }
        for (const [value, count] of Object.entries(row.insets)) {
          merged.insets[value] = (merged.insets[value] || 0) + count;
        }
      }
    }
  }
  const severityRank = { S1: 0, S2: 1, S3: 2 };
  const ordered = [...clusters.values()].sort(
    (a, b) =>
      (b.captures.size > 1) - (a.captures.size > 1) ||
      severityRank[a.severity] - severityRank[b.severity] ||
      b.captures.size - a.captures.size ||
      b.occurrences.length - a.occurrences.length,
  );
  const nearMisses = censusNearMisses(census);
  return {
    probed,
    skipped,
    surfaces: [...surfaces.values()],
    clusters: ordered,
    settled: [...settledHits.values()],
    census,
    nearMisses,
  };
}

function plural(count, word) {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

/**
 * A value made safe inside a Markdown table cell: backslashes first, so the
 * escape added for a pipe cannot be undone by one already in the text.
 */
function cell(text) {
  return String(text ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/\|/g, "\\|")
    .replace(/\n/g, " ");
}

export function renderMarkdown(report) {
  const lines = [];
  const flagged = report.clusters.reduce((sum, cluster) => sum + cluster.occurrences.length, 0);
  lines.push("# Pixel probe report", "");
  lines.push(
    `${plural(report.probed, "record")} probed, ${plural(report.skipped.length, "record")} skipped, across ${plural(report.surfaces.length, "capture")}. ${plural(flagged, "flag")} in ${plural(report.clusters.length, "cluster")}; ${plural(report.settled.length, "settled cluster")}.`,
    "",
    "Every flag is a candidate, not a verdict: give each one a verdict with its measurement (docs/design/pixel-craft.md). Crops are under `e2e/pixel-probe/crops/`, the state atlas under `e2e/pixel-probe/atlas/` (`--atlas` builds contact sheets), and 1:1 tiles of any capture come from `node scripts/pixel-probe-report.mjs --tiles <capture>`.",
    "",
  );
  lines.push(
    "## By check",
    "",
    "| # | Check | Severity | Clusters | Flags |",
    "| --- | --- | --- | --- | --- |",
  );
  for (const [check, meta] of Object.entries(CHECKS)) {
    const mine = report.clusters.filter((cluster) => cluster.check === check);
    if (mine.length === 0) continue;
    const count = mine.reduce((sum, cluster) => sum + cluster.occurrences.length, 0);
    lines.push(
      `| ${meta.n} | ${meta.title} (\`${check}\`) | ${meta.severity} | ${mine.length} | ${count} |`,
    );
  }
  lines.push(
    "",
    "## Clusters",
    "",
    "Shared first (a cluster seen on more than one capture), then by severity and reach.",
    "",
  );
  report.clusters.forEach((cluster, index) => {
    const meta = CHECKS[cluster.check] || { title: cluster.check };
    lines.push(
      `### C${index + 1}. ${cluster.severity} ${meta.title} — ${plural(cluster.captures.size, "capture")}, ${plural(cluster.occurrences.length, "flag")}`,
      "",
      `- **Signature:** \`${cluster.sig.slice(0, 220)}\``,
      `- **In:** \`${(cluster.csig || "—").slice(0, 160)}\``,
      `- **Grep:** \`${cell(cluster.cls).slice(0, 200)}\``,
      `- **Families:** ${[...cluster.families].join(", ")}`,
      `- **Example:** ${cell(cluster.occurrences[0].msg)}`,
    );
    const crops = cluster.occurrences.filter((occurrence) => occurrence.crop).slice(0, 3);
    if (crops.length > 0)
      lines.push(`- **Crops:** ${crops.map((occurrence) => `\`${occurrence.crop}\``).join(", ")}`);
    const where = cluster.occurrences
      .slice(0, 12)
      .map(
        (occurrence) =>
          `${occurrence.capture}@${occurrence.sweep ? "sweep-" : ""}${occurrence.width}${occurrence.state ? `(${occurrence.state})` : ""}`,
      );
    lines.push(
      `- **Where:** ${where.join(", ")}${cluster.occurrences.length > 12 ? `, … ${cluster.occurrences.length - 12} more` : ""}`,
      "",
    );
  });
  if (report.nearMisses.length > 0) {
    lines.push(
      "## Census: one family, values 1–3px apart",
      "",
      "Same component family (signature minus colour), rendered at near-identical sizes. Each row is a lead: two sizes a person reads as one component drawn two ways.",
      "",
      "| Family | Metric | Values | Counts | Signatures |",
      "| --- | --- | --- | --- | --- |",
    );
    for (const miss of report.nearMisses.slice(0, 80)) {
      lines.push(
        `| \`${cell(miss.family).slice(0, 90)}\` | ${miss.metric} | ${miss.values.join(" / ")} | ${miss.counts.join(" / ")} | ${miss.sigs.length} |`,
      );
    }
    lines.push("");
  }
  const rowInsets = Object.entries(report.census.rows)
    .filter(([, row]) => row.n >= 2)
    .sort((a, b) => b[1].n - a[1].n)
    .slice(0, 40);
  if (rowInsets.length > 0) {
    lines.push(
      "## Census: where full-width rows start their content",
      "",
      "Rows that span a rounded, painted container, and the inset (from the container's outer edge) their content starts at. Two row components with different insets on neighbouring surfaces are a lead.",
      "",
      "| Row | Insets (px: count) | Rows | Captures |",
      "| --- | --- | --- | --- |",
    );
    for (const [sig, row] of rowInsets) {
      const insets = Object.entries(row.insets)
        .sort((a, b) => b[1] - a[1])
        .map(([value, count]) => `${value}: ${count}`)
        .join(", ");
      lines.push(
        `| \`${cell(sig).slice(0, 90)}\` | ${insets} | ${row.n} | ${row.captures.slice(0, 4).join(", ")} |`,
      );
    }
    lines.push("");
  }
  if (report.settled.length > 0) {
    lines.push(
      "## Settled",
      "",
      "Flags `scripts/pixel-probe-settled.json` has judged right — listed, never dropped.",
      "",
    );
    for (const cluster of report.settled) {
      lines.push(
        `- **${cluster.check}** \`${cluster.sig.slice(0, 120)}\` — ${plural(cluster.occurrences.length, "flag")}. ${cluster.settled.reason} (${cluster.settled.pointer})`,
      );
    }
    lines.push("");
  }
  lines.push("## By surface family", "");
  for (const family of FAMILIES) {
    const mine = report.surfaces.filter((surface) => surface.family === family.key);
    if (mine.length === 0) continue;
    lines.push(
      `### ${family.title}`,
      "",
      "| Capture | Route | Flags | Re-run |",
      "| --- | --- | --- | --- |",
    );
    for (const surface of mine.sort((a, b) => String(a.capture).localeCompare(String(b.capture)))) {
      const flags = Object.entries(surface.flags)
        .map(([check, count]) => `${check} ${count}`)
        .join(", ");
      const skipped =
        surface.skipped.length > 0 ? ` **skipped:** ${surface.skipped.join("; ")}` : "";
      lines.push(
        `| ${cell(surface.capture)} | \`${surface.route ?? "?"}\` | ${cell(flags || "none")}${cell(skipped)} | \`${cell(surface.rerun)}\` |`,
      );
    }
    lines.push("");
  }
  if (report.skipped.length > 0) {
    lines.push("## Skipped", "");
    for (const entry of report.skipped)
      lines.push(`- ${entry.capture} @ ${entry.width}: ${entry.why}`);
    lines.push("");
  }
  return `${lines.join("\n")}\n`;
}

// ---------------------------------------------------------------------------
// Tiles.

export const TILE_SIZES = {
  390: { width: 390, height: 1560 },
  820: { width: 820, height: 1180 },
  1280: { width: 1280, height: 880 },
  1920: { width: 960, height: 1080 },
};

export function tileGrid(imageWidth, imageHeight, tile) {
  const cells = [];
  for (let y = 0; y < imageHeight; y += tile.height) {
    for (let x = 0; x < imageWidth; x += tile.width) {
      cells.push({
        x,
        y,
        width: Math.min(tile.width, imageWidth - x),
        height: Math.min(tile.height, imageHeight - y),
      });
    }
  }
  return cells;
}

async function cutTiles(capture) {
  const safe = capture.replace(/[^A-Za-z0-9._-]+/g, "-");
  const outDir = path.join(OUT, "tiles", safe);
  fs.mkdirSync(outDir, { recursive: true });
  const indexFile = path.join(OUT, "tiles", "index.json");
  const index = readJson(indexFile, {});
  const files = fs.existsSync(SCREENSHOTS)
    ? fs
        .readdirSync(SCREENSHOTS)
        .filter((file) => file.startsWith(`${safe}-light-vw-`) && file.endsWith(".png"))
    : [];
  if (files.length === 0) {
    console.error(`No e2e/screenshots/${safe}-light-vw-*.png — run the capture first.`);
    process.exitCode = 1;
    return;
  }
  const written = [];
  const same = [];
  for (const file of files.sort()) {
    const width = Number(file.match(/-vw-(\d+)\.png$/)?.[1]);
    const tile = TILE_SIZES[width] ?? { width: Math.min(width, 1280), height: 880 };
    const image = sharp(path.join(SCREENSHOTS, file));
    const meta = await image.metadata();
    const cells = tileGrid(meta.width, meta.height, tile);
    for (const [n, cellBox] of cells.entries()) {
      const { data } = await sharp(path.join(SCREENSHOTS, file))
        .extract({ left: cellBox.x, top: cellBox.y, width: cellBox.width, height: cellBox.height })
        .raw()
        .toBuffer({ resolveWithObject: true });
      const hash = crypto.createHash("sha1").update(data).digest("hex");
      const name = `vw-${width}-${String(n + 1).padStart(2, "0")}-y${cellBox.y}.png`;
      const target = path.join(outDir, name);
      if (index[hash] && index[hash] !== path.relative(ROOT, target)) {
        same.push(`${name} = ${index[hash]}`);
        continue;
      }
      await sharp(path.join(SCREENSHOTS, file))
        .extract({ left: cellBox.x, top: cellBox.y, width: cellBox.width, height: cellBox.height })
        .png()
        .toFile(target);
      index[hash] = path.relative(ROOT, target);
      written.push(path.relative(ROOT, target));
    }
  }
  fs.writeFileSync(indexFile, `${JSON.stringify(index)}\n`);
  console.log(written.join("\n"));
  if (same.length > 0)
    console.log(`\nskipped (identical to a tile already cut):\n${same.join("\n")}`);
}

// ---------------------------------------------------------------------------
// Atlas sheets.

async function atlasSheets() {
  const atlasDir = path.join(OUT, "atlas");
  const sheetsDir = path.join(OUT, "atlas-sheets");
  fs.mkdirSync(sheetsDir, { recursive: true });
  const entries = fs
    .readdirSync(atlasDir)
    .filter((file) => file.endsWith(".json"))
    .map((file) => ({
      hash: file.replace(/\.json$/, ""),
      ...readJson(path.join(atlasDir, file), {}),
    }))
    .filter((entry) => fs.existsSync(path.join(atlasDir, `${entry.hash}-rest.png`)))
    .sort((a, b) => String(a.sig).localeCompare(String(b.sig)));
  const MAX = 1568;
  const PIXELS = 1_150_000;
  const GAP = 8;
  const rows = [];
  for (const [n, entry] of entries.entries()) {
    const parts = [];
    for (const state of ["rest", "hover", "focus"]) {
      const file = path.join(atlasDir, `${entry.hash}-${state}.png`);
      if (!fs.existsSync(file)) continue;
      const meta = await sharp(file).metadata();
      parts.push({ file, width: meta.width, height: meta.height });
    }
    const across = parts.reduce((sum, part) => sum + part.width + GAP, 0);
    const vertical = across > MAX;
    const width = vertical ? Math.max(...parts.map((part) => part.width)) : across;
    const height = vertical
      ? parts.reduce((sum, part) => sum + part.height + GAP, 0)
      : Math.max(...parts.map((part) => part.height)) + GAP;
    rows.push({
      n: n + 1,
      entry,
      parts,
      vertical,
      width: Math.min(width, MAX),
      height: height + 24,
    });
  }
  const sheets = [];
  let current = [];
  let used = 0;
  let widest = 0;
  for (const row of rows) {
    const nextWidest = Math.max(widest, row.width);
    if (
      current.length > 0 &&
      (used + row.height > MAX || nextWidest * (used + row.height) > PIXELS)
    ) {
      sheets.push(current);
      current = [];
      used = 0;
      widest = 0;
    }
    current.push(row);
    used += row.height;
    widest = Math.max(widest, row.width);
  }
  if (current.length > 0) sheets.push(current);
  const index = [
    "# State atlas",
    "",
    "Each control signature, once, at rest | hover | focus (desktop, light).",
    "",
  ];
  for (const [s, sheet] of sheets.entries()) {
    const width = Math.max(...sheet.map((row) => row.width));
    const height = sheet.reduce((sum, row) => sum + row.height, 0);
    const composites = [];
    let top = 0;
    for (const row of sheet) {
      const label = Buffer.from(
        `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="22"><rect width="100%" height="100%" fill="#222"/><text x="6" y="16" font-family="monospace" font-size="13" fill="#fff">#${row.n}</text></svg>`,
      );
      composites.push({ input: label, left: 0, top });
      let x = 0;
      let y = top + 24;
      for (const part of row.parts) {
        if (x + part.width > width || y + part.height > height) continue;
        composites.push({ input: part.file, left: x, top: y });
        if (row.vertical) y += part.height + GAP;
        else x += part.width + GAP;
      }
      top += row.height;
      index.push(
        `- **#${row.n}** (sheet ${s + 1}) \`${String(row.entry.sig).slice(0, 200)}\` — ${row.entry.capture} \`${row.entry.url}\``,
      );
    }
    const file = path.join(sheetsDir, `sheet-${String(s + 1).padStart(3, "0")}.png`);
    await sharp({ create: { width, height, channels: 4, background: "#9a9a9a" } })
      .composite(composites)
      .png()
      .toFile(file);
    console.log(path.relative(ROOT, file));
  }
  fs.writeFileSync(path.join(OUT, "ATLAS.md"), `${index.join("\n")}\n`);
  console.log(
    `${path.relative(ROOT, path.join(OUT, "ATLAS.md"))} — ${rows.length} signatures on ${sheets.length} sheets`,
  );
}

// ---------------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);
  if (args[0] === "--tiles") {
    if (!args[1]) {
      console.error("Usage: node scripts/pixel-probe-report.mjs --tiles <capture>");
      process.exit(1);
    }
    await cutTiles(args[1]);
    return;
  }
  if (args[0] === "--atlas") {
    await atlasSheets();
    return;
  }
  const records = loadRecords();
  if (records.length === 0) {
    console.error(
      'No probe output in e2e/pixel-probe/captures — run `PIXEL_PROBE=1 pnpm e2e:run e2e/visual.spec.ts --grep "light mode"` first.',
    );
    process.exit(1);
  }
  const settled = readJson(SETTLED, { settled: [] }).settled ?? [];
  const ledger = readJson(ROUTES, {});
  const report = buildReport(records, { settled, ledger });
  fs.writeFileSync(path.join(OUT, "REPORT.md"), renderMarkdown(report));
  fs.writeFileSync(
    path.join(OUT, "clusters.json"),
    `${JSON.stringify(
      {
        probed: report.probed,
        skipped: report.skipped,
        clusters: report.clusters.map((cluster) => ({
          ...cluster,
          captures: [...cluster.captures],
          families: [...cluster.families],
        })),
        nearMisses: report.nearMisses,
        surfaces: report.surfaces,
      },
      null,
      1,
    )}\n`,
  );
  console.log(
    `e2e/pixel-probe/REPORT.md — ${report.probed} probed, ${report.skipped.length} skipped, ${report.clusters.length} clusters, ${report.settled.length} settled`,
  );
}

// Run as a CLI, not when a test imports it. Compared through realpath: on a
// case-insensitive disk `argv[1]` keeps the caller's spelling of the path and
// `import.meta.url` does not.
if (process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href) {
  await main();
}
