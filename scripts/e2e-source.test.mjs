import { describe, expect, it } from "vitest";
import { calls, literal, tokens } from "./e2e-source.mjs";
import { runBounded, SUBPROCESS_TIMEOUTS } from "./subprocess.mjs";

describe("source lexer", () => {
  it("keeps quoted text, templates and regex classes opaque, with exact offsets", () => {
    const source = String.raw`// test.skip('comment')
/* test.only('comment') */
test('real', () => { const a = "test.skip('quoted')"; const b = \`test.only('template')\`; const c = /[\]()/]+\/x/gi; });`.replaceAll(
      "\\`",
      "`",
    );
    const found = calls(source);
    expect(found.map((call) => call.name)).toEqual(["test"]);
    expect(found[0].start).toBe(source.indexOf("test('real'"));
    expect(source.slice(found[0].start, found[0].end)).toBe(source.slice(found[0].start, -1));
    expect(tokens(source).some((token) => token.text === String.raw`/[\]()/]+\/x/gi`)).toBe(true);
    expect(literal("`plain`")).toBe("plain");
    expect(literal("`value ${name}`")).toBeNull();
  });

  it("preserves escaped quotes and nested call arguments", () => {
    const source = String.raw`test("a\"b", { tag: ['x', 'y'] }, async () => helper(/a\\b/));`;
    const found = calls(source);
    expect(found.map((call) => call.name)).toEqual(["test", "async", "helper"]);
    expect(found[0].args).toHaveLength(3);
    expect(found[0].arg).toBe(String.raw`"a\"b"`);
  });

  it("finishes adversarial and malformed inputs in a bounded child process", () => {
    const code = `import { tokens } from ${JSON.stringify(new URL("./e2e-source.mjs", import.meta.url).href)};
const start = performance.now();
for (const source of [
  '/' + String.raw\`\\[\\]\`.repeat(100_000),
  '/[' + '/'.repeat(100_000),
  '/*'.repeat(100_000),
  String.raw\`\\'\`.repeat(100_000),
]) tokens(source);
console.log(performance.now() - start);`;
    const result = runBounded(process.execPath, ["--input-type=module", "-e", code], {
      timeoutMs: Math.min(5_000, SUBPROCESS_TIMEOUTS.nodeScript),
      encoding: "utf8",
    });
    expect(result.status, result.stderr).toBe(0);
    expect(Number(result.stdout.trim())).toBeLessThan(5_000);
  });
});
