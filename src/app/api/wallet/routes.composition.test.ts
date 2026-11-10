// @vitest-environment node
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";

it("keeps every PassKit handler thin and free of credential-bearing logging", () => {
  const handlers = readdirSync(import.meta.dirname, { recursive: true, encoding: "utf8" }).filter(
    (name) => name.endsWith("route.ts"),
  );
  expect(handlers.length).toBeGreaterThanOrEqual(4);
  for (const path of handlers) {
    const source = readFileSync(join(import.meta.dirname, path), "utf8");
    expect(source, path).not.toMatch(/\b(?:console\.(?:log|warn|error)|log)\s*\(/);
    expect(source, path).toContain("appleServiceResponse");
    expect(source, path).not.toContain('request.headers.get("Authorization")');
  }
});
