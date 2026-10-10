import { describe, expect, it } from "vitest";

import { runGuard } from "./guard-fixture.mjs";

const CANVAS = "docs/design/canvases/20261010-one-hand";
const ADR = "docs/architecture/decisions/20261010-one-hand.md";

const readme = ({ status = "Live", rows = [] } = {}) =>
  [
    "# One hand",
    "",
    `- **Status:** ${status}`,
    "- **ADR:** [one hand](../../../architecture/decisions/20261010-one-hand.md)",
    "",
    "| Slice | Status | Lands in |",
    "| --- | --- | --- |",
    ...rows.map(([slice, status, lands]) => `| ${slice} — A slice | ${status} | ${lands} |`),
    "",
  ].join("\n");

const canvas = (files = {}) => ({
  [ADR]: "# 20261010-one-hand — One hand\n",
  [`${CANVAS}/Main.dc.html`]: "<div></div>\n",
  [`${CANVAS}/canvas.json`]: JSON.stringify({ artboards: [{ file: "Main.dc.html" }] }),
  [`${CANVAS}/README.md`]: readme(),
  ...files,
});

const run = (files) => runGuard("check-design-canvases.mjs", files);

describe("check-design-canvases", () => {
  it("passes a complete canvas", () => {
    const result = run(canvas());
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Design canvases: 1 checked.");
  });

  it("passes a checkout with no canvases at all", () => {
    expect(run({ "docs/": "" }).status).toBe(0);
  });

  it("refuses a directory not named for its ADR", () => {
    const files = Object.fromEntries(
      Object.entries(canvas()).map(([file, body]) => [
        file.replace("20261010-one-hand/", "OneHand/"),
        body,
      ]),
    );
    expect(run(files).stderr).toContain("canvases/OneHand: directory must be named YYYYMMDD-slug");
  });

  it("refuses a seeded payload committed into the canvas", () => {
    const { stderr } = run(canvas({ [`${CANVAS}/payload.json`]: "x".repeat(401_000) }));
    expect(stderr).toContain("payload.json: 392 KB exceeds 391 KB");
  });

  it("names a canvas with no artboards, a misnamed one, and one canvas.json does not place", () => {
    const { stderr } = run(
      canvas({ [`${CANVAS}/Main.dc.html`]: undefined, [`${CANVAS}/kit.dc.html`]: "<div></div>\n" }),
    );
    expect(stderr).toContain("kit.dc.html: artboards are named <Name>.dc.html in PascalCase");
    expect(stderr).toContain("canvas.json: does not place kit.dc.html");
  });

  it("refuses a missing canvas.json and README", () => {
    const files = canvas();
    delete files[`${CANVAS}/canvas.json`];
    delete files[`${CANVAS}/README.md`];
    const { stderr } = run(files);
    expect(stderr).toContain(`${CANVAS}: missing canvas.json`);
    expect(stderr).toContain(`${CANVAS}: missing README.md naming its ADR and status`);
  });

  it("refuses a status word it does not know, and an ADR that does not exist", () => {
    const files = canvas({ [`${CANVAS}/README.md`]: readme({ status: "Draft" }) });
    delete files[ADR];
    const { stderr } = run(files);
    expect(stderr).toContain("README.md: Status must begin with Live, Shipped, Superseded");
    expect(stderr).toContain("names ADR 20261010-one-hand, which does not exist");
  });

  it("holds a shipped slice to a file that exists and names the ADR", () => {
    const { stderr } = run(
      canvas({
        "src/Named.tsx": "// ADR 20261010-one-hand\n",
        "src/Silent.tsx": "export {};\n",
        [`${CANVAS}/README.md`]: readme({
          rows: [
            ["1", "shipped", "`src/Named.tsx`"],
            ["2", "shipped", "`src/Silent.tsx`"],
            ["3", "shipped", "`src/Gone.tsx`"],
            ["4", "shipped", "—"],
            ["5", "maybe", "—"],
            ["6", "open", "—"],
          ],
        }),
      }),
    );
    expect(stderr).not.toContain("slice 1 ");
    expect(stderr).toContain("slice 2 shipped into src/Silent.tsx, which does not mention");
    expect(stderr).toContain("slice 3 names src/Gone.tsx, which does not exist");
    expect(stderr).toContain("slice 4 is shipped but names no file");
    expect(stderr).toContain('slice 5 has status "maybe"');
  });

  it("refuses a Live canvas whose every slice is settled", () => {
    const { stderr } = run(
      canvas({
        "src/Named.tsx": "// ADR 20261010-one-hand\n",
        [`${CANVAS}/README.md`]: readme({
          rows: [
            ["1", "shipped", "`src/Named.tsx`"],
            ["2", "dropped", "—"],
          ],
        }),
      }),
    );
    expect(stderr).toContain("every slice is shipped or dropped, so Status may no longer be Live");
  });
});
