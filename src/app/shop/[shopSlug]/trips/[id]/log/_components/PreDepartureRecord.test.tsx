// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { staffTranslator } from "@/i18n/staff-messages";
import { SailedWithSnags } from "./PreDepartureRecord";

afterEach(cleanup);

const t = staffTranslator("en-US");

describe("SailedWithSnags", () => {
  it("names each snag open when the boat sailed, and who wrote it when", () => {
    render(
      <SailedWithSnags
        snags={[
          {
            itemLabel: "Radio check",
            note: "VHF crackles on 16",
            notedByName: "Sal Moretti",
            notedAt: "2026-08-04T09:15:00.000Z",
          },
        ]}
        t={t}
        dateTime={() => "Aug 4, 5:15 AM EDT"}
      />,
    );
    expect(screen.getByRole("heading", { name: "Open on the boat when it sailed" })).toBeTruthy();
    expect(screen.getByRole("listitem").textContent).toBe(
      "Radio check: VHF crackles on 16. Noted by Sal Moretti\u00a0· Aug 4, 5:15 AM EDT",
    );
  });

  it("says nothing for a boat that sailed with none", () => {
    const { container } = render(<SailedWithSnags snags={[]} t={t} dateTime={String} />);
    expect(container.innerHTML).toBe("");
  });
});
