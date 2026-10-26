// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { LedgerRow } from "./ledger";

afterEach(cleanup);
it("keeps a local editor after the row summary and its independent control", () => {
  const { rerender } = render(
    <ul>
      <LedgerRow
        trailing={<button type="button">Arrange help</button>}
        below={
          <form>
            <label>
              Helper
              <input name="helper" />
            </label>
          </form>
        }
      >
        <p>Diego asked for help</p>
      </LedgerRow>
    </ul>,
  );
  const row = screen.getByRole("listitem");
  const form = screen.getByRole("textbox", { name: "Helper" }).closest("form");
  if (!form) throw new Error("Local editor form is missing");
  expect(row).toContainElement(form);
  expect(screen.getByRole("button", { name: "Arrange help" }).closest("form")).toBeNull();
  expect(screen.getByText("Diego asked for help").compareDocumentPosition(form)).toBe(
    Node.DOCUMENT_POSITION_FOLLOWING,
  );
  rerender(
    <ul>
      <LedgerRow trailing={<button type="button">Arrange help</button>}>
        <p>Diego asked for help</p>
      </LedgerRow>
    </ul>,
  );
  expect(screen.queryByRole("textbox", { name: "Helper" })).toBeNull();
  expect(screen.getByRole("button", { name: "Arrange help" })).toBeVisible();
});
