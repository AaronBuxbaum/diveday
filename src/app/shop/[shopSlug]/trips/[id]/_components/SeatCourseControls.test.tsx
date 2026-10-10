// @vitest-environment jsdom

import { cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { fixtures, renderRoster } from "./roster-test-fixtures";

afterEach(cleanup);

describe("certifying a student from a course session's roster (issue #2059)", () => {
  /** One per student row; every one of them opens the same way. */
  function awardSelects() {
    const selects = screen.getAllByRole("combobox", { name: /^Level/ }) as HTMLSelectElement[];
    expect(selects).toHaveLength(2);
    return selects;
  }

  it("opens on the level the course issues", () => {
    renderRoster({ ...fixtures, certifyDefaultLevel: "advanced_open_water" });
    for (const select of awardSelects()) expect(select.value).toBe("advanced_open_water");
  });

  /**
   * **No level is put in front of the instructor when the course issues
   * none** (dive-domain review). Opening on Open Water there turned a stray
   * "Certify" tap into a verified card nobody chose.
   */
  it("opens on an empty, required choice when the course issues no level", () => {
    renderRoster({ ...fixtures, certifyDefaultLevel: null });
    const [select] = awardSelects();
    expect(select?.value).toBe("");
    expect(select).toBeRequired();
    expect(select?.options[0]?.value).toBe("");
    expect(select?.options[0]?.disabled).toBe(true);
    expect([...(select?.options ?? [])].map((option) => option.value)).toContain(
      "advanced_open_water",
    );
  });

  it("draws no Certify control where the session certifies nobody", () => {
    renderRoster({ ...fixtures });
    expect(screen.queryByText("Certify")).toBeNull();
    expect(screen.queryAllByRole("combobox", { name: /^Level/ })).toHaveLength(0);
  });
});
