import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  classifyTestFile,
  isSourceGuard,
  literalGlob,
  PROJECT_NAMES,
  partitionTestFiles,
} from "./projects";

const ROOT = path.resolve(__dirname, "../..");
// Spelled in pieces so that this file's own source does not match the rules it
// tests: the classifier reads source text, and so does Vitest's docblock parser.
const FIXTURE = ["@", "test", "db"].join("/");
const ENV = ["@vitest", "environment"].join("-");

describe("classifyTestFile", () => {
  it("sends a file that imports the database fixture to db, wherever it lives", () => {
    const source = `import { seededShopContext } from "${FIXTURE}";`;
    expect(classifyTestFile("src/db/bookings.test.ts", source)).toBe("db");
    expect(classifyTestFile("src/app/api/search/route.test.ts", source)).toBe("db");
    expect(classifyTestFile("src/lib/session.test.ts", source)).toBe("db");
    expect(
      classifyTestFile(
        "src/db/x.test.ts",
        `import { x } from "${FIXTURE.replace("db", "query-count")}";`,
      ),
    ).toBe("db");
    expect(classifyTestFile("src/test/x.test.ts", ["await ", "createTestDb", "();"].join(""))).toBe(
      "db",
    );
  });

  it("sends a jsdom docblock to ui, and only a docblock", () => {
    expect(classifyTestFile("src/components/A.test.tsx", `// ${ENV} jsdom\nimport x`)).toBe("ui");
    expect(classifyTestFile("src/components/A.test.tsx", `/**\n * ${ENV} jsdom\n */`)).toBe("ui");
    expect(classifyTestFile("src/lib/a.test.ts", `const s = "${ENV} jsdom is a docblock";`)).toBe(
      "lib",
    );
  });

  it("sends a pure source-text guard to guards", () => {
    const guard = [
      `import { readFileSync } from "node:fs";`,
      `import { describe, expect, it } from "vitest";`,
      `it("reads", () => expect(readFileSync("x", "utf8")).toContain("y"));`,
    ].join("\n");
    expect(classifyTestFile("src/app/tap-highlight.test.ts", guard)).toBe("guards");
  });

  it("keeps a guard that also imports app code, mocks, or spawns out of guards", () => {
    const reads = `import { readFileSync } from "node:fs";\nconst text = readFileSync("x", "utf8");\n`;
    expect(isSourceGuard(`${reads}import { x } from "./brand";`)).toBe(false);
    expect(isSourceGuard(`${reads}import type { X } from "@/db/schema";`)).toBe(false);
    expect(isSourceGuard(`${reads}vi.mock("./x");`)).toBe(false);
    expect(isSourceGuard(`${reads}const m = await import("./route");`)).toBe(false);
    expect(isSourceGuard(`${reads}import { execFileSync } from "node:child_process";`)).toBe(false);
    expect(isSourceGuard(`import { x } from "node:path";`)).toBe(false);
    expect(isSourceGuard(`${reads}import { rule } from "@/test/stylesheet";`)).toBe(true);
  });

  it("does not mistake an import quoted in a comment or a string fixture for the file's own", () => {
    const guard = [
      `import { readFileSync } from "node:fs";`,
      "/**",
      ` * Pages that are a bare re-export (\`export { default } from "./SettingsPage"\`)`,
      " */",
      "const fixture = [",
      '  `import { a } from "./a";`,',
      '  `const seed = await import("./seed");`,',
      "];",
      `const text = readFileSync("x", "utf8");`,
    ].join("\n");
    expect(isSourceGuard(guard)).toBe(true);
  });

  it("puts src/lib in lib unless the file owns its module registry", () => {
    expect(classifyTestFile("src/lib/trips.test.ts", `import { x } from "./trips";`)).toBe("lib");
    expect(classifyTestFile("src/lib/payments/a.test.ts", `import { x } from "./a";`)).toBe("lib");
    for (const call of ["vi.mock", "vi.doMock", "vi.resetModules", "vi.stubEnv", "vi.stubGlobal"]) {
      expect(classifyTestFile("src/lib/a.test.ts", `${call}("x");`)).toBe("node");
    }
  });

  it("sends scripts/** to scripts and everything else to node", () => {
    expect(classifyTestFile("scripts/check-copy.test.mjs", "")).toBe("scripts");
    expect(classifyTestFile("infra/test/stack.test.ts", "")).toBe("node");
    expect(classifyTestFile("src/app/actions/x.test.ts", `import { x } from "./x";`)).toBe("node");
  });
});

describe("partitionTestFiles", () => {
  it("puts every test file in this repository in exactly one project", () => {
    const groups = partitionTestFiles(ROOT);
    const all = PROJECT_NAMES.flatMap((name) => groups[name]);
    expect(new Set(all).size).toBe(all.length);
    expect(all).toContain("src/test/projects.test.ts");
    expect(all).toContain("src/db/bookings.test.ts");
    expect(all.some((file) => file.includes("node_modules"))).toBe(false);
    for (const name of PROJECT_NAMES) expect(groups[name].length).toBeGreaterThan(0);
  });
});

describe("literalGlob", () => {
  it("escapes the route-folder brackets a glob would read as a character class", () => {
    expect(literalGlob("src/app/shop/[shopSlug]/page.test.ts")).toBe(
      "src/app/shop/\\[shopSlug\\]/page.test.ts",
    );
    expect(literalGlob("src/app/(marketing)/a.test.ts")).toBe("src/app/\\(marketing\\)/a.test.ts");
  });
});
