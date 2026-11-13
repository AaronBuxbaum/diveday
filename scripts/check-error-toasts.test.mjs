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
  it("lets the toast, comments and listed files through", () => {
    expect(findInlineErrors("src/components/Toast.tsx", 'role="alert"')).toEqual([]);
    expect(findInlineErrors("src/components/X.tsx", ' * `role="alert"` is the toast')).toEqual([]);
    expect(findInlineErrors("src/components/X.tsx", "<ErrorToast message={x} />")).toEqual([]);
  });
});
