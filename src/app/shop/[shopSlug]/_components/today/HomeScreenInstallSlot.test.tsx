// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { staffTranslator } from "@/i18n/staff-messages";
import { type Role, STAFF_ROLES } from "@/lib/authz";
import { HomeScreenInstallSlot } from "./HomeScreenInstallSlot";

vi.mock("./HomeScreenInstall", () => ({
  HomeScreenInstall: ({ copy }: { copy: { body: string } }) => <aside>{copy.body}</aside>,
}));
afterEach(cleanup);
describe("the manifest's role gate", () => {
  it.each(STAFF_ROLES)("offers the device convenience to %s", (role) => {
    const t = staffTranslator("en-US");
    render(<HomeScreenInstallSlot roles={[role]} t={t} />);
    expect(screen.getByText(t("shopHome.install.body"))).toBeVisible();
  });
  it.each([{ roles: [] }, { roles: ["diver"] }] satisfies { roles: Role[] }[])(
    "offers nothing without a staff role ($roles)",
    ({ roles }) => {
      const t = staffTranslator("en-US");
      render(<HomeScreenInstallSlot roles={roles} t={t} />);
      expect(screen.queryByText(t("shopHome.install.body"))).not.toBeInTheDocument();
    },
  );
});
