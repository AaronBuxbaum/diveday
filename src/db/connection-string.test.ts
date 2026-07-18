import { describe, expect, it } from "vitest";
import { withExplicitSslMode } from "./connection-string";

describe("withExplicitSslMode", () => {
  it.each(["prefer", "require", "verify-ca"])(
    "replaces legacy sslmode=%s with verify-full",
    (sslMode) => {
      const url = withExplicitSslMode(`postgres://user:pass@example.com/db?sslmode=${sslMode}`);

      expect(new URL(url).searchParams.get("sslmode")).toBe("verify-full");
    },
  );

  it("preserves an explicit verify-full mode", () => {
    const url = "postgres://user:pass@example.com/db?sslmode=verify-full";

    expect(withExplicitSslMode(url)).toBe(url);
  });

  it("preserves URLs that explicitly opt into libpq semantics", () => {
    const url = "postgres://user:pass@example.com/db?uselibpqcompat=true&sslmode=require";

    expect(withExplicitSslMode(url)).toBe(url);
  });

  it("preserves other connection URLs", () => {
    const url = "postgres://user:pass@example.com/db?sslmode=disable";

    expect(withExplicitSslMode(url)).toBe(url);
  });
});
