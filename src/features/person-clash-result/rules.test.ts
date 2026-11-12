import { afterEach, expect, it, vi } from "vitest";
import { openPersonClashResult, sealPersonClashResult } from "./rules";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

it("protects the transaction's names and binds its result to the shop, trip and freshness", () => {
  vi.stubEnv("DIVEDAY_CLOCK", "");
  vi.spyOn(Date, "now").mockReturnValue(1_800_000_000_000);
  const rows = [{ personName: "Race Diver", otherTitle: "Target" }];
  const token = sealPersonClashResult("shop", "trip", rows);
  expect(token).not.toContain("Race Diver");
  expect(openPersonClashResult(token, "shop", "trip")).toEqual({ clashes: rows, omitted: 0 });
  expect(openPersonClashResult(token, "other", "trip")).toBeNull();
  expect(openPersonClashResult(token, "shop", "other")).toBeNull();
  expect(openPersonClashResult(`${token}x`, "shop", "trip")).toBeNull();
  vi.spyOn(Date, "now").mockReturnValue(1_800_000_121_000);
  expect(openPersonClashResult(token, "shop", "trip")).toBeNull();
});

it("states how many conflicts do not fit the redirect", () => {
  const rows = Array.from({ length: 100 }, (_, i) => ({
    personName: `Diver ${i}`.repeat(20),
    otherTitle: "Target".repeat(20),
  }));
  const token = sealPersonClashResult("shop", "trip", rows);
  const result = openPersonClashResult(token, "shop", "trip");
  expect(result?.omitted).toBeGreaterThan(0);
  expect((result?.clashes.length ?? 0) + (result?.omitted ?? 0)).toBe(rows.length);
});

it("refuses a noncanonical spelling of the authentication tag", () => {
  const token = sealPersonClashResult("shop", "trip", [{ personName: "Ana", otherTitle: "Reef" }]);
  const [iv, tag, body] = token.split(".");
  if (!iv || !tag || !body) throw new Error("expected token parts");
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  const last = alphabet.indexOf(tag.at(-1) ?? "");
  const alternate = `${tag.slice(0, -1)}${alphabet[last + 1]}`;
  expect(Buffer.from(alternate, "base64url").equals(Buffer.from(tag, "base64url"))).toBe(true);
  expect(openPersonClashResult(`${iv}.${alternate}.${body}`, "shop", "trip")).toBeNull();
});
