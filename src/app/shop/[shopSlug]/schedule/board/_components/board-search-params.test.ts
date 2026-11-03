import { describe, expect, it } from "vitest";
import { clearBoardResultParams } from "./board-search-params";

describe("clearBoardResultParams", () => {
  it("removes consumed result values and preserves board context", () => {
    const cleaned = clearBoardResultParams(
      new URL(
        "https://example.test/shop/blue-mantis/schedule/board?week=2026-10-26&add=full&builder=moved&result=abc&held=hold&tell=2#week",
      ),
    );
    expect(cleaned.pathname + cleaned.search + cleaned.hash).toBe(
      "/shop/blue-mantis/schedule/board?week=2026-10-26&add=full&held=hold&tell=2#week",
    );
  });
});
