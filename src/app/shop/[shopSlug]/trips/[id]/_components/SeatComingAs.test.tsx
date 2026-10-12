// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { staffTranslator } from "@/i18n/staff-messages";
import { entry, noop } from "./roster-test-fixtures";
import { SeatComingAs } from "./SeatComingAs";

afterEach(cleanup);

const t = staffTranslator("en-US");

describe("SeatComingAs", () => {
  it("keeps the participant type folded and offers no way past a card check nobody refused", () => {
    const { container } = render(
      <SeatComingAs
        booking={entry("a", "Asha Osei").booking}
        t={t}
        certRefused={false}
        setParticipantTypeAction={noop}
      />,
    );
    expect(container.querySelector("details")?.open).toBe(false);
    expect(
      screen.queryByRole("button", { name: t("participants.roster.changeAnyway") }),
    ).toBeNull();
    expect((screen.getByRole("combobox") as HTMLSelectElement).value).toBe("diver");
  });

  it("opens on a refused card check and offers the one way past it, as a diver", () => {
    const { container } = render(
      <SeatComingAs
        booking={entry("a", "Asha Osei").booking}
        t={t}
        certRefused
        setParticipantTypeAction={noop}
      />,
    );
    expect(container.querySelector("details")?.open).toBe(true);
    const past = screen.getByRole("button", { name: t("participants.roster.changeAnyway") });
    const form = past.closest("form") as HTMLFormElement;
    expect(new FormData(form).get("participantType")).toBe("diver");
    expect(new FormData(form).get("confirmCertBlock")).toBe("1");
  });
});
