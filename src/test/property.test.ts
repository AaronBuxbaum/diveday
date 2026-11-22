import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { checkProperty, settingsFromEnv } from "./property";

describe("checkProperty", () => {
  it("replays the same generated cases for the same seed", () => {
    const draw = () => {
      const seen: number[] = [];
      checkProperty(
        [fc.integer()],
        (value) => {
          seen.push(value);
        },
        { runs: 20, seed: 42, file: "x.test.ts" },
      );
      return seen;
    };
    const first = draw();
    expect(first).toHaveLength(20);
    expect(draw()).toEqual(first);
  });

  it("fails with the shrunk counterexample and the rerun command", () => {
    let message = "";
    try {
      checkProperty([fc.integer({ min: 0, max: 1000 })], (value) => value < 10, {
        runs: 200,
        seed: 7,
        file: "src/lib/example.properties.test.ts",
      });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain("Counterexample: [10]");
    expect(message).toContain("FC_SEED=7 pnpm test src/lib/example.properties.test.ts");
  });

  it("passes when the rule holds", () => {
    expect(() =>
      checkProperty([fc.integer()], (value) => Number.isInteger(value), {
        runs: 50,
        seed: 1,
        file: "x",
      }),
    ).not.toThrow();
  });
});

describe("settingsFromEnv", () => {
  it("honors FC_SEED and multiplies runs by FC_RUNS", () => {
    expect(settingsFromEnv({ FC_SEED: "123", FC_RUNS: "4" }, { runs: 50 }, "f")).toEqual({
      runs: 200,
      seed: 123,
      file: "f",
    });
  });

  it("draws a fresh seed and 300 runs by default", () => {
    expect(settingsFromEnv({}, {}, "f")).toEqual({ runs: 300, seed: undefined, file: "f" });
  });

  it("refuses a seed or run count that is not an integer", () => {
    expect(() => settingsFromEnv({ FC_SEED: "abc" }, {}, "f")).toThrow(/FC_SEED/);
    expect(() => settingsFromEnv({ FC_RUNS: "0" }, {}, "f")).toThrow(/positive integer/);
  });
});
