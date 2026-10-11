import { describe, expect, it } from "vitest";

import { runGuard } from "./guard-fixture.mjs";

// The guard reads two named files and walks three trees; each must exist.
const tree = (files) => ({
  "README.md": "# DiveDay\n",
  "AGENTS.md": "# Agents\n",
  "docs/": "",
  ".claude/skills/": "",
  ".claude/rules/": "",
  ...files,
});
const run = (files) => runGuard("check-doc-links.mjs", tree(files));

describe("check-doc-links", () => {
  it("passes a relative link to a file that exists, and counts a verified anchor", () => {
    const result = run({
      "docs/a.md": "See [b](b.md) and [its part](sub/c.md#the-part).\n",
      "docs/b.md": "# B\n",
      "docs/sub/c.md": "# C\n\n## The part\n",
    });
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    expect(result.stdout).toContain(
      "5 Markdown files have valid internal links (1 with a verified",
    );
  });

  it("refuses a link to a file that is not there, from the file that carries it", () => {
    const result = run({ "AGENTS.md": "[gone](docs/gone.md)\n" });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("AGENTS.md: docs/gone.md -> docs/gone.md");
  });

  it("refuses an anchor no heading in the target makes", () => {
    const { stderr } = run({
      "docs/a.md": "[x](b.md#nowhere)\n",
      "docs/b.md": "# B\n\n## Somewhere\n",
    });
    expect(stderr).toContain('docs/a.md: b.md#nowhere -> no heading "#nowhere" in docs/b.md');
  });

  it("slugs a heading the way GitHub does — code, links and emphasis stripped", () => {
    expect(
      run({
        "docs/a.md": "[x](b.md#the-pnpm-check-guard-and-its-why) [y](b.md#explicit)\n",
        "docs/b.md":
          '# B\n\n## The `pnpm check` guard, and [its](x.md) *why*\n\n<a id="explicit"></a>\n',
        "docs/x.md": "# X\n",
      }).status,
    ).toBe(0);
  });

  it("does not read a heading inside a fenced block as an anchor", () => {
    const { stderr } = run({
      "docs/a.md": "[x](b.md#fenced)\n",
      "docs/b.md": "# B\n\n```md\n## Fenced\n```\n",
    });
    expect(stderr).toContain('no heading "#fenced"');
  });

  it("leaves external links, mail links, images and same-file fragments alone", () => {
    expect(
      run({
        "docs/a.md":
          "[w](https://example.com/x.md) [m](mailto:a@b.c) ![i](missing.png) [f](#local)\n",
      }).status,
    ).toBe(0);
  });

  it("walks the skills and rules too", () => {
    const { stderr } = run({ ".claude/rules/db.md": "[gone](../../docs/nope.md)\n" });
    expect(stderr).toContain(".claude/rules/db.md: ../../docs/nope.md -> docs/nope.md");
  });
});
