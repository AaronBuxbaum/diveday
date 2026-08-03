import { describe, expect, it, vi } from "vitest";
import { offsetPage } from "./paging";

/** A stand-in list, sliced the way a `limit`/`offset` query would slice it. */
function fakeSource(total: number) {
  const all = Array.from({ length: total }, (_, index) => index + 1);
  const fetchRows = vi.fn(async (offset: number, limit: number) =>
    all.slice(offset, offset + limit),
  );
  const countRows = vi.fn(async () => all.length);
  return { all, fetchRows, countRows };
}

describe("offsetPage", () => {
  it("serves the requested page and states the whole set", async () => {
    const source = fakeSource(23);
    const page = await offsetPage({ page: 2, pageSize: 10, ...source });
    expect(page.rows).toEqual([11, 12, 13, 14, 15, 16, 17, 18, 19, 20]);
    expect(page).toMatchObject({ page: 2, pageCount: 3, pageSize: 10, total: 23 });
  });

  it("visits every row exactly once across the pages it claims", async () => {
    const source = fakeSource(23);
    const first = await offsetPage({ pageSize: 10, ...source });
    const seen: number[] = [];
    for (let page = 1; page <= first.pageCount; page++) {
      const chunk = await offsetPage({ page, pageSize: 10, ...source });
      seen.push(...chunk.rows);
    }
    expect(seen).toEqual(source.all);
    expect(new Set(seen).size).toBe(seen.length);
  });

  it("reads a page below 1 as the first page rather than a negative offset", async () => {
    for (const requested of [0, -3, -0.5]) {
      const source = fakeSource(23);
      const page = await offsetPage({ page: requested, pageSize: 10, ...source });
      expect(page.page).toBe(1);
      // Never a negative offset reaching the driver.
      expect(source.fetchRows.mock.calls.every(([offset]) => offset >= 0)).toBe(true);
    }
  });

  it("reads NaN as the first page — Math.max(1, NaN) is NaN, not 1", async () => {
    const source = fakeSource(23);
    const page = await offsetPage({ page: Number.NaN, pageSize: 10, ...source });
    expect(page.page).toBe(1);
    expect(source.fetchRows).toHaveBeenCalledWith(0, 10);
  });

  it("lands a page past the end on the last real page, with rows on it", async () => {
    // A bookmarked `?page=9` on a list that has since shrunk. An empty table
    // under "Page 9 of 3" is a heading that cannot be true.
    const source = fakeSource(23);
    const page = await offsetPage({ page: 9, pageSize: 10, ...source });
    expect(page.page).toBe(3);
    expect(page.pageCount).toBe(3);
    expect(page.rows).toEqual([21, 22, 23]);
  });

  it("costs one extra row query only when the request was past the end", async () => {
    const inRange = fakeSource(23);
    await offsetPage({ page: 2, pageSize: 10, ...inRange });
    expect(inRange.fetchRows).toHaveBeenCalledTimes(1);

    const past = fakeSource(23);
    await offsetPage({ page: 9, pageSize: 10, ...past });
    expect(past.fetchRows).toHaveBeenCalledTimes(2);
  });

  it("reports one page for an empty list rather than zero", async () => {
    const source = fakeSource(0);
    const page = await offsetPage({ page: 4, pageSize: 10, ...source });
    expect(page).toMatchObject({ rows: [], page: 1, pageCount: 1, total: 0 });
  });

  it("refuses a page size below one instead of dividing by zero", async () => {
    const source = fakeSource(5);
    const page = await offsetPage({ pageSize: 0, ...source });
    expect(page.pageSize).toBe(1);
    expect(page.pageCount).toBe(5);
    expect(page.rows).toEqual([1]);
  });
});
