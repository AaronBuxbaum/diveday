// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { staffTranslator } from "@/i18n/staff-messages";
import { TodayNoticeStack } from "./TodayNoticeStack";

afterEach(cleanup);

const t = staffTranslator("en-US");

function renderResetNotice(reset: "1" | "refused") {
  return render(
    <TodayNoticeStack reset={reset} seriesCount={0} firstBookableMoment={false} t={t} />,
  );
}

describe("TodayNoticeStack demo reset notice", () => {
  it("shows the success copy only for a completed reset", () => {
    renderResetNotice("1");

    expect(screen.getByText(t("shopHome.demoReset"))).toBeTruthy();
    expect(screen.queryByText(t("shopHome.demoResetRefused"))).toBeNull();
  });

  it("shows an accessible refusal instead of the success copy when reset is blocked", () => {
    renderResetNotice("refused");

    expect(screen.getByRole("status").textContent).toBe(t("shopHome.demoResetRefused"));
    expect(screen.queryByText(t("shopHome.demoReset"))).toBeNull();
  });
});
