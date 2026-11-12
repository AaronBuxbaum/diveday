import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { installedNodeRanges } from "./installed-node-ranges.mjs";

const fixtures = [];
afterEach(() => {
  for (const fixture of fixtures.splice(0)) rmSync(fixture, { recursive: true, force: true });
});

function fixture() {
  const base = mkdtempSync(path.join(os.tmpdir(), "diveday-node-ranges-"));
  fixtures.push(base);
  const project = path.join(base, "project");
  mkdirSync(path.join(project, "node_modules", ".pnpm", "node_modules"), { recursive: true });
  return { base, project };
}

function manifest(directory, name, range) {
  mkdirSync(directory, { recursive: true });
  writeFileSync(
    path.join(directory, "package.json"),
    JSON.stringify({
      name,
      version: "1.0.0",
      ...(range ? { engines: { node: range } } : {}),
    }),
  );
  return directory;
}

function link(target, destination) {
  mkdirSync(path.dirname(destination), { recursive: true });
  symlinkSync(target, destination, "junction");
}

describe("installed Node engine ranges", () => {
  it("follows the current global-store graph, including scoped peers, without other projects", () => {
    const { base, project } = fixture();
    const graph = path.join(base, "store", "links", "wrapper", "graph", "node_modules");
    const wrapper = manifest(path.join(graph, "wrapper"), "wrapper");
    const peer = manifest(
      path.join(base, "store", "links", "peer", "graph", "node_modules", "@test", "peer"),
      "@test/peer",
      "^24.15.0",
    );
    manifest(
      path.join(base, "store", "links", "unrelated", "node_modules", "other"),
      "other",
      ">=26.0.0",
    );
    link(wrapper, path.join(project, "node_modules", "wrapper"));
    link(peer, path.join(graph, "@test", "peer"));
    expect([...installedNodeRanges(project)]).toEqual([["@test/peer@1.0.0", "^24.15.0"]]);
  });

  it("follows project-store links without counting stale unlinked packages", () => {
    const { project } = fixture();
    const modules = path.join(project, "node_modules");
    const active = manifest(
      path.join(modules, ".pnpm", "active", "node_modules", "active"),
      "active",
      "^24.15.0",
    );
    manifest(path.join(modules, ".pnpm", "stale", "node_modules", "stale"), "stale", ">=26.0.0");
    link(active, path.join(modules, "active"));
    expect([...installedNodeRanges(project)]).toEqual([["active@1.0.0", "^24.15.0"]]);
  });

  it("reads nested physical packages and terminates dependency cycles", () => {
    const { project } = fixture();
    const wrapper = manifest(path.join(project, "node_modules", "wrapper"), "wrapper");
    const child = manifest(path.join(wrapper, "node_modules", "child"), "child", ">=24.15.0");
    link(wrapper, path.join(child, "node_modules", "wrapper"));
    link(path.join(project, "absent"), path.join(wrapper, "node_modules", "optional"));
    expect([...installedNodeRanges(project)]).toEqual([["child@1.0.0", ">=24.15.0"]]);
  });

  it("fails closed when the installed graph is empty", () => {
    const { project } = fixture();
    expect(() => installedNodeRanges(project)).toThrow(/No installed packages/);
  });
});
