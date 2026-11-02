import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { allowMarker, pageRoutes, sourceFiles, withoutComments } from "./source-tree.mjs";

async function tree(files) {
  const root = await mkdtemp(path.join(tmpdir(), "source-tree-"));
  for (const [relative, contents] of Object.entries(files)) {
    await mkdir(path.join(root, path.dirname(relative)), { recursive: true });
    await writeFile(path.join(root, relative), contents);
  }
  return root;
}

describe("sourceFiles", () => {
  it("lists .ts and .tsx recursively, absolute, and leaves tests out by default", async () => {
    const root = await tree({
      "a.ts": "",
      "deep/b.tsx": "",
      "deep/b.test.tsx": "",
      "c.mjs": "",
      "d.css": "",
    });
    expect(sourceFiles(root).sort()).toEqual([
      path.join(root, "a.ts"),
      path.join(root, "deep/b.tsx"),
    ]);
  });

  it("takes other extensions, keeps tests on request, and reads a missing directory as empty", async () => {
    const root = await tree({ "c.mjs": "", "c.test.mjs": "" });
    expect(sourceFiles(root, { ext: [".mjs"], skipTests: false }).sort()).toEqual([
      path.join(root, "c.mjs"),
      path.join(root, "c.test.mjs"),
    ]);
    expect(sourceFiles(path.join(root, "nope"))).toEqual([]);
  });
});

describe("pageRoutes", () => {
  it("folds route groups out of the url and skips private folders", async () => {
    const root = await tree({
      "src/app/page.tsx": "",
      "src/app/loading.tsx": "",
      "src/app/(token)/ready/[token]/page.tsx": "",
      "src/app/(token)/ready/[token]/loading.tsx": "",
      "src/app/shop/[shopSlug]/_components/page.tsx": "",
      "src/app/shop/[shopSlug]/orders/page.tsx": "",
    });
    const routes = await pageRoutes(root);
    expect(routes.map((route) => [route.route, route.url])).toEqual([
      ["(token)/ready/[token]", "/ready/[token]"],
      [".", "/"],
      ["shop/[shopSlug]/orders", "/shop/[shopSlug]/orders"],
    ]);
    expect(routes.map((route) => route.has("loading.tsx"))).toEqual([true, true, false]);
    expect(routes[0].segments).toEqual(["(token)", "ready", "[token]"]);
  });

  it("is empty when there is no app directory", async () => {
    expect(await pageRoutes(await tree({ "README.md": "" }))).toEqual([]);
  });
});

describe("withoutComments", () => {
  it("drops line and block comments but keeps a URL", () => {
    expect(withoutComments("a // gone\nb /* gone */ c\nhttps://x.test")).toBe(
      "a \nb  c\nhttps://x.test",
    );
  });
});

describe("allowMarker", () => {
  it("reads the reason after the rule id", () => {
    expect(allowMarker("type-ramp", "// diveday:allow-type-ramp: a poster headline")).toEqual({
      status: "allowed",
      reason: "a poster headline",
    });
  });

  it("refuses an empty reason, with or without the colon", () => {
    expect(allowMarker("type-ramp", "// diveday:allow-type-ramp:")).toEqual({ status: "empty" });
    expect(allowMarker("type-ramp", "// diveday:allow-type-ramp")).toEqual({ status: "empty" });
    expect(allowMarker("type-ramp", "/* diveday:allow-type-ramp:   */")).toEqual({
      status: "empty",
    });
  });

  it("does not take one rule's marker for another's, or find none where there is none", () => {
    expect(allowMarker("type", "diveday:allow-type-ramp: x")).toEqual({ status: "none" });
    expect(allowMarker("type-ramp", "no marker here")).toEqual({ status: "none" });
  });
});
