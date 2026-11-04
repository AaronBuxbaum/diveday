import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { eventBridgeCron } from "./infra-stack";

describe("eventBridgeCron", () => {
  it.each([
    ["0 * * * *", "cron(0 * * * ? *)"],
    ["7 14 * * *", "cron(7 14 * * ? *)"],
    ["8 3 * * 0", "cron(8 3 ? * 1 *)"],
    ["4 * * * 0-2", "cron(4 * ? * 1-3 *)"],
    ["7 13 2,3 * *", "cron(7 13 2,3 * ? *)"],
    ["8 14,18,22 2,3 * *", "cron(8 14,18,22 2,3 * ? *)"],
    ["7 4 * * 1", "cron(7 4 ? * 2 *)"],
  ])("%s", (crontab, expected) => {
    expect(eventBridgeCron(crontab)).toBe(expected);
  });

  it("converts every entry of config/crons.json", () => {
    const { crons } = JSON.parse(readFileSync("config/crons.json", "utf8")) as {
      crons: { schedule: string }[];
    };
    expect(crons.length).toBeGreaterThan(10);
    for (const { schedule } of crons) expect(eventBridgeCron(schedule)).toMatch(/^cron\(.+ \*\)$/);
  });
});
