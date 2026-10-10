import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  canvasTitle,
  mergeStyles,
  parseArtboard,
  publishCanvas,
  styleChunks,
} from "./publish-canvas.mjs";

/**
 * A fixture canvas rather than a real one: a canvas under docs/design/ is
 * edited as a design moves, and a test reading it would flap with the drawing.
 */
const KIT = "/* kit:start — shared prose */\n.lede { font-size: 17px; }\n/* kit:end */";
const APP = "/* app:start — shared app */\n.app { border-radius: 24px; }\n/* app:end */";

function artboard(title, own, body) {
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>${title}</title>
  <script src="./support.js"></script>
</head>
<body>
<x-dc>
<helmet>
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Geist">
  <style>
    body { margin: 0; }
${KIT}
${APP}
${own}
  </style>
</helmet>
<div class="board">${body}</div>
</x-dc>
</body>
</html>`;
}

let dirs = [];
afterEach(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  dirs = [];
});

function fixtureCanvas() {
  const dir = mkdtempSync(path.join(os.tmpdir(), "canvas-"));
  dirs.push(dir);
  writeFileSync(
    path.join(dir, "canvas.json"),
    JSON.stringify({
      artboards: [
        { file: "Second.dc.html", title: "2 · Second", w: 1180, h: 900 },
        { file: "Main.dc.html", title: "Read me first", w: 1180, h: 600 },
      ],
    }),
  );
  writeFileSync(
    path.join(dir, "Main.dc.html"),
    artboard(
      "Main",
      "/* main:start */\n.hero { color: red; }\n/* main:end */",
      "<h1>Main board</h1>",
    ),
  );
  writeFileSync(
    path.join(dir, "Second.dc.html"),
    artboard(
      "Second",
      "/* second:start */\n.chip { color: blue; }\n/* second:end */",
      '<h1>Second board</h1><img src="./shot.jpg">',
    ),
  );
  writeFileSync(path.join(dir, "shot.jpg"), "not really a jpeg");
  writeFileSync(path.join(dir, "README.md"), "# Fixture canvas\n\nWords.\n");
  return dir;
}

describe("styleChunks / mergeStyles", () => {
  it("cuts a sheet at its marker comments", () => {
    expect(styleChunks(`body { margin: 0; }\n${KIT}\n${APP}`)).toEqual([
      "body { margin: 0; }",
      KIT,
      APP,
    ]);
  });

  it("emits a block two boards share once, and each board's own block once", () => {
    const merged = mergeStyles([
      `body { margin: 0; }\n${KIT}\n/* a:start */.a{}/* a:end */`,
      `body { margin: 0; }\n${KIT}\n/* b:start */.b{}/* b:end */`,
    ]);
    expect(merged.filter((chunk) => chunk === KIT)).toHaveLength(1);
    expect(merged.filter((chunk) => chunk === "body { margin: 0; }")).toHaveLength(1);
    expect(merged).toContain("/* a:start */.a{}/* a:end */");
    expect(merged).toContain("/* b:start */.b{}/* b:end */");
  });

  it("keeps two blocks of one name that differ, rather than dropping a board's styles", () => {
    const merged = mergeStyles([
      "/* kit:start */.x{color:red}/* kit:end */",
      "/* kit:start */.x{color:blue}/* kit:end */",
    ]);
    expect(merged).toHaveLength(2);
  });
});

describe("parseArtboard", () => {
  it("reads the helmet's links and styles and the board, and drops the editor's script", () => {
    const parsed = parseArtboard(artboard("T", "", "<p>Body</p>"));
    expect(parsed.links).toEqual([
      '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Geist">',
    ]);
    expect(parsed.css).toContain("kit:start");
    expect(parsed.body).toBe('<div class="board"><p>Body</p></div>');
    expect(parsed.body).not.toContain("support.js");
  });
});

describe("canvasTitle", () => {
  it("takes the README's first heading, or falls back to the directory", () => {
    expect(canvasTitle("# Clear the deck — read me\n\ntext", "x")).toBe("Clear the deck — read me");
    expect(canvasTitle("", "20260918-dir")).toBe("20260918-dir");
  });
});

describe("publishCanvas", () => {
  it("writes the boards in canvas.json's order, under a nav, with each shared block once", () => {
    const dir = fixtureCanvas();
    const out = mkdtempSync(path.join(os.tmpdir(), "canvas-out-"));
    dirs.push(out);
    const { target, boards, images } = publishCanvas(dir, { out });
    expect({ boards, images }).toEqual({ boards: 2, images: 1 });
    const html = readFileSync(path.join(target, "index.html"), "utf8");

    expect(html.indexOf("Second board")).toBeLessThan(html.indexOf("Main board"));
    expect(html.indexOf('href="#board-1">2 · Second')).toBeLessThan(
      html.indexOf('href="#board-2">Read me first'),
    );
    expect(html.match(/kit:start/g)).toHaveLength(1);
    expect(html.match(/app:start/g)).toHaveLength(1);
    expect(html).toContain("main:start");
    expect(html).toContain("second:start");
    expect(html.match(/fonts\.googleapis\.com/g)).toHaveLength(1);
    expect(html).toContain("<title>Fixture canvas</title>");
    expect(existsSync(path.join(target, "shot.jpg"))).toBe(true);
  });

  it("scales a 1180px board to fit rather than letting the page scroll sideways", () => {
    const dir = fixtureCanvas();
    const out = mkdtempSync(path.join(os.tmpdir(), "canvas-out-"));
    dirs.push(out);
    const html = readFileSync(path.join(publishCanvas(dir, { out }).target, "index.html"), "utf8");
    expect(html).toContain('data-width="1180"');
    expect(html).toContain("Math.min(1, room / width)");
    expect(html).toContain("overflow-x: hidden");
    expect(html).toContain('name="viewport"');
  });

  it("refuses a canvas.json with no artboards", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "canvas-"));
    dirs.push(dir);
    writeFileSync(path.join(dir, "canvas.json"), JSON.stringify({ artboards: [] }));
    expect(() => publishCanvas(dir, { out: dir })).toThrow(/no artboards/);
  });
});
