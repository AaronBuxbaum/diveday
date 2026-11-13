import { describe, expect, it } from "vitest";
import { findInlineErrors } from "./check-error-toasts.mjs";

describe("check-error-toasts", () => {
  it("refuses an alert component drawn on the page", () => {
    const found = findInlineErrors(
      "src/components/X.tsx",
      '<p role="alert" className="text-danger">no</p>',
    );
    expect(found).toHaveLength(1);
  });
  it("keeps persistent day-board safety conflicts while refusing ordinary page errors", () => {
    const alert = '<p role="alert">Boat departures overlap</p>';
    expect(
      findInlineErrors("src/app/shop/[shopSlug]/schedule/board/_components/DayBoard.tsx", alert),
    ).toEqual([]);
    expect(
      findInlineErrors("src/app/shop/[shopSlug]/schedule/board/_components/Other.tsx", alert),
    ).toHaveLength(1);
  });
  it("lets the toast, comments and listed files through", () => {
    expect(findInlineErrors("src/components/Toast.tsx", 'role="alert"')).toEqual([]);
    expect(findInlineErrors("src/components/X.tsx", ' * `role="alert"` is the toast')).toEqual([]);
    expect(findInlineErrors("src/components/X.tsx", "<ErrorToast message={x} />")).toEqual([]);
  });
});
