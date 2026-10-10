#!/usr/bin/env node
// Builds a design canvas into one gallery page a session can publish when the
// `/design` skill, and its `seed-canvas.mjs`, is not present (issue #1883).
//
// The artboards (`<Name>.dc.html`) stay the source and the skill's seeded
// editor payload stays the preferred published form where the skill exists
// (docs/design/design-artifacts.md, "Tooling"). This is the fallback: every
// board in `canvas.json`'s order under a sticky nav, each shared stylesheet
// block emitted once, scaled to fit any viewport, with the canvas's images
// copied beside it. The output goes to the gitignored `canvas-build/` and is
// never committed: a canvas directory holds sources only.
//
// The artboards are read as data, never tidied: `docs/design/canvases/**` is
// excluded from Biome on purpose ("Artboards are not app source").
//
//   node scripts/publish-canvas.mjs docs/design/canvases/<dir> [--out <dir>]
import { copyFileSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

export const DEFAULT_OUT = "canvas-build";
const IMAGE = /\.(?:jpe?g|png|gif|webp|svg|avif)$/i;

/**
 * One artboard's parts: its stylesheet links, the CSS inside its `<helmet>`
 * (or `<head>`) style elements, and the markup of its board. `null` parts are
 * absent rather than guessed.
 */
export function parseArtboard(html) {
  const helmet =
    /<helmet>([\s\S]*?)<\/helmet>/i.exec(html)?.[1] ??
    /<head>([\s\S]*?)<\/head>/i.exec(html)?.[1] ??
    "";
  const links = [...helmet.matchAll(/<link\b[^>]*rel=["']stylesheet["'][^>]*>/gi)].map((match) =>
    match[0].trim(),
  );
  const css = [...helmet.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)]
    .map((match) => match[1])
    .join("\n");
  const afterHelmet = html.includes("</helmet>") ? html.slice(html.indexOf("</helmet>") + 9) : html;
  const body =
    /([\s\S]*?)<\/x-dc>/i.exec(afterHelmet)?.[1] ??
    /<body\b[^>]*>([\s\S]*?)<\/body>/i.exec(afterHelmet)?.[1] ??
    afterHelmet;
  return { links, css, body: body.trim() };
}

/**
 * A stylesheet cut at its marker comments: every `/* <name>:start … *\/` …
 * `/* <name>:end *\/` block is one chunk, and the text between blocks is one
 * chunk each. The canvases paste their shared blocks verbatim into every
 * board, so equal chunks are equal text and can be emitted once.
 */
export function styleChunks(css) {
  const chunks = [];
  const marker = /\/\*\s*([\w-]+):start\b[\s\S]*?\*\/[\s\S]*?\/\*\s*\1:end\s*\*\//g;
  let last = 0;
  for (const match of css.matchAll(marker)) {
    const loose = css.slice(last, match.index).trim();
    if (loose) chunks.push(loose);
    chunks.push(match[0].trim());
    last = match.index + match[0].length;
  }
  const rest = css.slice(last).trim();
  if (rest) chunks.push(rest);
  return chunks;
}

/** Every chunk once, in first-seen order across the boards. */
export function mergeStyles(cssList) {
  const seen = new Set();
  const merged = [];
  for (const css of cssList) {
    for (const chunk of styleChunks(css)) {
      if (seen.has(chunk)) continue;
      seen.add(chunk);
      merged.push(chunk);
    }
  }
  return merged;
}

const escapeHtml = (text) =>
  String(text).replace(
    /[&<>"]/g,
    (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[character],
  );

// Fits each board's fixed width into the viewport without a horizontal scroll:
// the board keeps its drawn width and is scaled down, and its frame takes the
// scaled height so the page below it does not overlap.
const FIT_SCRIPT = `(() => {
  const fit = () => {
    for (const frame of document.querySelectorAll(".pc-frame")) {
      const width = Number(frame.dataset.width);
      const room = frame.parentElement.clientWidth;
      const scale = Math.min(1, room / width);
      const board = frame.firstElementChild;
      board.style.transform = "scale(" + scale + ")";
      frame.style.height = board.offsetHeight * scale + "px";
    }
  };
  addEventListener("resize", fit);
  addEventListener("load", fit);
  fit();
})();`;

/** The gallery page for a list of `{ title, width, body }` boards. */
export function galleryHtml({ title, links, styles, boards }) {
  const nav = boards
    .map((board, index) => `<a href="#board-${index + 1}">${escapeHtml(board.title)}</a>`)
    .join("\n      ");
  const sections = boards
    .map(
      (
        board,
        index,
      ) => `<section class="pc-board" id="board-${index + 1}" aria-label="${escapeHtml(board.title)}">
  <div class="pc-frame" data-width="${board.width}">
    <div class="pc-inner" style="width: ${board.width}px">
${board.body}
    </div>
  </div>
</section>`,
    )
    .join("\n");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
${[...new Set(links)].join("\n")}
<style>
${styles.join("\n\n")}

/* publish-canvas: the gallery's own chrome */
html, body { overflow-x: hidden; }
.pc-nav { position: sticky; top: 0; z-index: 10; display: flex; gap: 16px; overflow-x: auto; white-space: nowrap; padding: 10px 16px; background: rgba(251, 250, 247, 0.94); border-bottom: 1px solid rgba(0, 0, 0, 0.08); font: 500 13px/1.4 system-ui, sans-serif; }
.pc-nav a { color: inherit; text-decoration: none; }
.pc-nav a:hover { text-decoration: underline; }
.pc-board { padding: 24px 16px; scroll-margin-top: 48px; }
.pc-frame { overflow: hidden; }
.pc-inner { transform-origin: top left; }
</style>
</head>
<body>
<nav class="pc-nav" aria-label="Boards">
      ${nav}
</nav>
${sections}
<script>${FIT_SCRIPT}</script>
</body>
</html>
`;
}

/** The canvas's title: its README's first heading, or the directory name. */
export function canvasTitle(readme, fallback) {
  const heading = /^#\s+(.+)$/m.exec(readme ?? "")?.[1]?.trim();
  return heading || fallback;
}

/** Reads a canvas directory and writes `<out>/<dir name>/index.html` plus its images. */
export function publishCanvas(canvasDir, { out = DEFAULT_OUT } = {}) {
  const manifest = JSON.parse(readFileSync(path.join(canvasDir, "canvas.json"), "utf8"));
  const artboards = Array.isArray(manifest.artboards) ? manifest.artboards : [];
  if (artboards.length === 0) throw new Error(`${canvasDir}/canvas.json lists no artboards`);
  const parsed = artboards.map((artboard) => ({
    artboard,
    ...parseArtboard(readFileSync(path.join(canvasDir, artboard.file), "utf8")),
  }));
  let readme = "";
  try {
    readme = readFileSync(path.join(canvasDir, "README.md"), "utf8");
  } catch {
    // A canvas without a README fails check:design-canvases; the title falls back.
  }
  const name = path.basename(path.resolve(canvasDir));
  const html = galleryHtml({
    title: canvasTitle(readme, name),
    links: parsed.flatMap((board) => board.links),
    styles: mergeStyles(parsed.map((board) => board.css)),
    boards: parsed.map(({ artboard, body }) => ({
      title: artboard.title || artboard.file,
      width: Number(artboard.w) || 1180,
      body,
    })),
  });
  const target = path.join(out, name);
  mkdirSync(target, { recursive: true });
  writeFileSync(path.join(target, "index.html"), html);
  const images = readdirSync(canvasDir).filter((file) => IMAGE.test(file));
  for (const image of images) copyFileSync(path.join(canvasDir, image), path.join(target, image));
  return { target, boards: parsed.length, images: images.length };
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const args = process.argv.slice(2);
  const outAt = args.indexOf("--out");
  const out = outAt === -1 ? DEFAULT_OUT : args[outAt + 1];
  const canvasDir = args.find((arg, index) => !arg.startsWith("--") && index !== outAt + 1);
  if (!canvasDir || !out) {
    console.error(
      "Usage: node scripts/publish-canvas.mjs docs/design/canvases/<dir> [--out <dir>]",
    );
    process.exit(1);
  }
  try {
    const { target, boards, images } = publishCanvas(canvasDir, { out });
    console.log(
      `publish-canvas: ${boards} board(s) and ${images} image(s) written to ${target}/index.html. Publish that file with its images beside it; it is build output and is never committed.`,
    );
  } catch (err) {
    console.error(`publish-canvas: ${err.message}`);
    process.exit(1);
  }
}
