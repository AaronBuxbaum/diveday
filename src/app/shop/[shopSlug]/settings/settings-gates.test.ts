import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, normalize, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * **No page under `/settings` is an ungated reader (issue #2739), and the
 * frame is not the gate.** `settings/layout.tsx` draws the rail only; a
 * redirect there would beat the page's own and replace its reason ("Billing is
 * limited to the owner") with the generic one. So each page names its gate
 * itself: an `allow:` in `page.tsx` or in a sibling module it renders through.
 */
const ROOT = new URL(".", import.meta.url).pathname;

function pages(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return pages(path);
    return name === "page.tsx" ? [path] : [];
  });
}

type ReadSource = (file: string) => string | undefined;
type Binding = { file: string; name: string };

/** Small source-only gate tracer: it never imports or runs a page or permission reader. */
function settingsPageHasGate(page: string, root: string, read: ReadSource): boolean {
  const cache = new Map<string, string[]>();
  const tokens = (file: string): string[] => {
    const cached = cache.get(file);
    if (cached) return cached;
    const source = read(file) ?? "";
    const result = [
      ...source.matchAll(
        /\/\*[\s\S]*?\*\/|\/\/[^\n]*|"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*'|`(?:\\[\s\S]|[^`\\])*`|[A-Za-z_$][\w$]*|[^\s]/g,
      ),
    ]
      .map((match) => match[0])
      .filter((token) => !token.startsWith("//") && !token.startsWith("/*"));
    cache.set(file, result);
    return result;
  };
  function close(t: string[], start: number): number {
    const end = ({ "{": "}", "(": ")", "[": "]" } as Record<string, string>)[t[start]];
    if (!end) return -1;
    for (let i = start + 1; i < t.length; i++) {
      if (t[i] === end) return i;
      if (["{", "(", "["].includes(t[i])) {
        i = close(t, i);
        if (i < 0) return -1;
      }
    }
    return -1;
  }
  function parts(t: string[], start: number, end: number): string[][] {
    const result: string[][] = [];
    let at = start;
    for (let i = start; i < end; i++) {
      if (["{", "(", "["].includes(t[i])) {
        const next = close(t, i);
        if (next < 0) return [];
        i = next;
      } else if (t[i] === ",") {
        result.push(t.slice(at, i));
        at = i + 1;
      }
    }
    result.push(t.slice(at, end));
    return result;
  }
  function moduleFile(file: string, quoted: string): string | undefined {
    if (!/^["']/.test(quoted ?? "")) return undefined;
    const specifier = quoted.slice(1, -1);
    const base = specifier.startsWith("@/")
      ? join(root, "src", specifier.slice(2))
      : specifier.startsWith(".")
        ? normalize(join(dirname(file), specifier))
        : undefined;
    if (!base) return undefined;
    return [
      base,
      `${base}.ts`,
      `${base}.tsx`,
      join(base, "index.ts"),
      join(base, "index.tsx"),
    ].find((candidate) => read(candidate) !== undefined);
  }
  function imports(file: string): Map<string, Binding> {
    const t = tokens(file);
    const found = new Map<string, Binding>();
    for (let i = 0; i < t.length; i++) {
      if (t[i] !== "import" || t[i + 1] !== "{") continue;
      const end = close(t, i + 1);
      if (end < 0 || t[end + 1] !== "from") continue;
      const target = moduleFile(file, t[end + 2]);
      if (!target) continue;
      for (const spec of parts(t, i + 2, end)) {
        if (spec[0] === "type" || !spec[0]) continue;
        found.set(spec[1] === "as" ? spec[2] : spec[0], { file: target, name: spec[0] });
      }
      i = end;
    }
    return found;
  }
  function exported(file: string, name: string, seen: Set<string>): Binding | undefined {
    const key = `${file}#${name}`;
    if (seen.has(key)) return undefined;
    seen.add(key);
    const t = tokens(file);
    for (let i = 0; i < t.length; i++) {
      if (t[i] !== "export") continue;
      if (t[i + 1] === "const" && t[i + 2] === name) return { file, name };
      if (name === "default" && t[i + 1] === "default") return { file, name };
      if (t[i + 1] !== "{") continue;
      const end = close(t, i + 1);
      if (end < 0) continue;
      for (const spec of parts(t, i + 2, end)) {
        if (spec[0] === "type" || (spec[1] === "as" ? spec[2] : spec[0]) !== name) continue;
        if (t[end + 1] === "from") {
          const target = moduleFile(file, t[end + 2]);
          if (target) return exported(target, spec[0], seen);
        } else {
          const binding = imports(file).get(spec[0]);
          return binding ? exported(binding.file, binding.name, seen) : { file, name: spec[0] };
        }
      }
    }
    return undefined;
  }
  function optionAllows(file: string, option: string[], seen = new Set<string>()): boolean {
    const t = tokens(file);
    if (option[0] === "{") {
      const end = close(option, 0);
      return (
        end >= 0 &&
        parts(option, 1, end).some((property) => {
          if (property[0] !== "allow" || property[1] !== ":" || property.length !== 3) return false;
          const predicate = property[2];
          return (
            !["true", "false", "null", "undefined"].includes(predicate) &&
            /^[A-Za-z_$][\w$]*$/.test(predicate) &&
            (imports(file).has(predicate) ||
              t.some((token, i) => token === "function" && t[i + 1] === predicate))
          );
        })
      );
    }
    if (option.length !== 1 || !/^[A-Za-z_$][\w$]*$/.test(option[0])) return false;
    const key = `${file}#${option[0]}`;
    if (seen.has(key)) return false;
    const local = t.findIndex((token, i) => token === "const" && t[i + 1] === option[0]);
    if (local >= 0) {
      seen.add(key);
      let start = local + 2;
      while (start < t.length && t[start] !== "=" && t[start] !== ";") start++;
      if (t[start] !== "=") return false;
      const end = t[start + 1] === "{" ? close(t, start + 1) + 1 : start + 2;
      return optionAllows(file, t.slice(start + 1, end), seen);
    }
    const binding = imports(file).get(option[0]);
    const origin = binding && exported(binding.file, binding.name, new Set());
    return !!origin && optionAllows(origin.file, [origin.name], seen);
  }
  function visit(file: string, seen: Set<string>): boolean {
    if (seen.has(file)) return false;
    seen.add(file);
    const t = tokens(file);
    const bound = imports(file);
    for (let i = 0; i < t.length; i++) {
      if (t[i] !== "await" || t[i + 2] !== "(") continue;
      const binding = bound.get(t[i + 1]);
      if (
        binding?.name !== "requireShopSurface" ||
        binding.file !== join(root, "src/features/session/index.ts")
      )
        continue;
      const end = close(t, i + 2);
      if (end >= 0) {
        const args = parts(t, i + 3, end);
        if (args[1] && optionAllows(file, args[1])) return true;
      }
    }
    // Follow the actual default route delegation, never an arbitrary imported sibling.
    const target = exported(file, "default", new Set());
    return !!target && target.file !== file && visit(target.file, seen);
  }
  return visit(page, new Set());
}

const project = process.cwd();
const readSource = (file: string) => {
  try {
    return readFileSync(file, "utf8");
  } catch {
    return undefined;
  }
};

describe("every settings page names its own gate", () => {
  it.each(pages(ROOT).map((p) => relative(ROOT, p)))("%s", (page) => {
    expect(settingsPageHasGate(join(ROOT, page), project, readSource)).toBe(true);
  });
});

const fixtures = {
  "/repo/src/features/session/index.ts": "export function requireShopSurface() {}",
  "/repo/src/features/access/index.ts": 'export { OWNER_GATE as SETTINGS_GATE } from "./policy";',
  "/repo/src/features/access/policy.ts":
    'import { canManage } from "./permissions"; export const OWNER_GATE = { allow: canManage } as const;',
  "/repo/src/features/access/permissions.ts": "export function canManage() { return false; }",
};
function guarded(source: string, additional: Record<string, string> = {}) {
  const files: Record<string, string> = { ...fixtures, "/repo/page.tsx": source, ...additional };
  return settingsPageHasGate("/repo/page.tsx", "/repo", (file) => files[file]);
}
const surface = 'import { requireShopSurface } from "@/features/session";';
const importedGate = 'import { SETTINGS_GATE as policy } from "@/features/access";';

describe("the permission contract passed to the surface gate", () => {
  it("follows the bound options through a public re-export and import alias", () => {
    expect(guarded(`${surface} ${importedGate} await requireShopSurface(slug, policy);`)).toBe(
      true,
    );
  });
  it("accepts an inline permission predicate", () => {
    expect(
      guarded(
        `${surface} import { canManage } from "./src/features/access/permissions"; await requireShopSurface(slug, { allow: canManage });`,
      ),
    ).toBe(true);
  });
  it("follows actual default page delegation without a filename exception", () => {
    expect(
      guarded('export { default } from "./content";', {
        "/repo/content.tsx": `${surface} ${importedGate} export default async function Content() { await requireShopSurface(slug, policy); }`,
      }),
    ).toBe(true);
  });
  it("rejects an imported impostor policy even when its module contains another allow", () => {
    expect(
      guarded(`${surface} ${importedGate} await requireShopSurface(slug, policy);`, {
        "/repo/src/features/access/policy.ts":
          "export const OWNER_GATE = {}; const unused = { allow: canManage };",
      }),
    ).toBe(false);
  });
  it("rejects an ungated call even when a valid gate was imported", () => {
    expect(guarded(`${surface} ${importedGate} await requireShopSurface(slug);`)).toBe(false);
  });
  it("rejects an impostor gate and an unrelated allow property", () => {
    expect(
      guarded(
        `${surface} ${importedGate} const other = { allow: canManage }; const empty = {}; await requireShopSurface(slug, empty);`,
      ),
    ).toBe(false);
  });
  it.each(["true", "undefined", '"canManage"', "{ allow: canManage }"])(
    "rejects non-predicate allow value %s",
    (value) => {
      expect(guarded(`${surface} await requireShopSurface(slug, { allow: ${value} });`)).toBe(
        false,
      );
    },
  );
  it("does not count a gate in a comment, quoted example or unused sibling", () => {
    expect(
      guarded(
        `${surface} // await requireShopSurface(slug, { allow: canManage });\n const example = "allow: canManage"; import { Content } from "./content"; await requireShopSurface(slug);`,
        {
          "/repo/content.tsx": `${surface} ${importedGate} await requireShopSurface(slug, policy);`,
        },
      ),
    ).toBe(false);
  });
  it("rejects an unawaited gate", () => {
    expect(guarded(`${surface} ${importedGate} requireShopSurface(slug, policy);`)).toBe(false);
  });
  it("rejects a local function impersonating the real surface gate", () => {
    expect(
      guarded(
        `${importedGate} function requireShopSurface() {} await requireShopSurface(slug, policy);`,
      ),
    ).toBe(false);
  });
});
