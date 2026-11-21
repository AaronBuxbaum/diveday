// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { staffTranslator } from "@/i18n/staff-messages";
import { FactorManagementSection } from "./FactorManagementSection";
import { PasskeySection } from "./PasskeySection";

vi.mock("../actions", () => ({
  verifyFactorManagementPasswordAction: vi.fn(),
  verifyStepUpAction: vi.fn(),
}));
vi.mock("@/app/actions/passkeys", () => ({
  beginPasskeyRegistrationAction: vi.fn(),
  completePasskeyRegistrationAction: vi.fn(),
  deletePasskeyAction: vi.fn(),
  renamePasskeyAction: vi.fn(),
}));
vi.mock("@/app/_components/PasskeyAuthentication", () => ({
  PasskeyAuthentication: ({ label }: { label: string }) => <button type="button">{label}</button>,
}));
const { supportsPasskeys } = vi.hoisted(() => ({ supportsPasskeys: vi.fn(() => true) }));
vi.mock("@/features/accounts/passkeys", () => ({ browserSupportsPasskeys: supportsPasskeys }));
beforeEach(() => supportsPasskeys.mockReturnValue(true));

afterEach(cleanup);

for (const locale of ["en-US", "es-ES"] as const) {
  const t = staffTranslator(locale);
  const passkeyWord = locale === "en-US" ? /passkey/i : /clave de acceso/i;
  const codeWord = locale === "en-US" ? /authenticator/i : /autenticador/i;

  describe(`staff passkey presentation ${locale}`, () => {
    it("does not call the browser unsupported before checking its capability", () => {
      const initial = document.createElement("div");
      initial.innerHTML = renderToString(
        <PasskeySection
          shopSlug="blue-mantis"
          locked={false}
          passkeys={[]}
          locale={locale}
          timeZone="America/New_York"
          t={t}
        />,
      );
      expect(initial.textContent).toContain(t("settings.security.passkeys.empty"));
      expect(initial.textContent).not.toContain(t("settings.security.passkeys.unavailable"));
    });

    it("keeps the password fallback when the browser capability check fails", () => {
      supportsPasskeys.mockReturnValue(false);
      render(
        <PasskeySection
          shopSlug="blue-mantis"
          locked={false}
          passkeys={[]}
          locale={locale}
          timeZone="America/New_York"
          t={t}
        />,
      );
      expect(screen.getByText(t("settings.security.passkeys.unavailable"))).toBeVisible();
      expect(
        screen.queryByRole("button", { name: t("settings.security.passkeys.add") }),
      ).toBeNull();
    });

    it("names only the available passkey and password when TOTP is off", () => {
      const { container } = render(
        <FactorManagementSection
          shopSlug="blue-mantis"
          verified={false}
          hasPasskeys
          hasTotp={false}
          t={t}
        />,
      );
      expect(container.textContent).toMatch(passkeyWord);
      expect(container.textContent).not.toMatch(codeWord);
      expect(screen.getByLabelText(t("settings.security.factorManagement.password"))).toBeVisible();
      expect(screen.queryByLabelText(t("settings.security.stepUpCodeLabel"))).toBeNull();
    });

    it("names only the available code and password when no key is saved", () => {
      const { container } = render(
        <FactorManagementSection
          shopSlug="blue-mantis"
          verified={false}
          hasPasskeys={false}
          hasTotp
          t={t}
        />,
      );
      expect(container.textContent).toMatch(codeWord);
      expect(container.textContent).not.toMatch(passkeyWord);
      expect(screen.getByLabelText(t("settings.security.stepUpCodeLabel"))).toBeVisible();
      expect(screen.getByLabelText(t("settings.security.factorManagement.password"))).toBeVisible();
    });

    it("names both enrolled methods when both choices are available", () => {
      const { container } = render(
        <FactorManagementSection
          shopSlug="blue-mantis"
          verified={false}
          hasPasskeys
          hasTotp
          t={t}
        />,
      );
      expect(container.textContent).toMatch(passkeyWord);
      expect(container.textContent).toMatch(codeWord);
      expect(screen.getByLabelText(t("settings.security.stepUpCodeLabel"))).toBeVisible();
      expect(
        screen.getByRole("button", { name: t("settings.security.passkeys.verify") }),
      ).toBeVisible();
    });

    it("gives the empty key section a nested heading without another glyph or Add action", () => {
      render(
        <PasskeySection
          shopSlug="blue-mantis"
          locked={false}
          passkeys={[]}
          locale={locale}
          timeZone="America/New_York"
          t={t}
        />,
      );
      const title = screen.getByRole("heading", {
        level: 3,
        name: t("settings.security.passkeys.empty"),
      });
      expect(title.parentElement?.querySelector("svg")).toBeNull();
      expect(title.parentElement?.querySelector("button")).toBeNull();
      expect(
        screen.getAllByRole("button", { name: t("settings.security.passkeys.add") }),
      ).toHaveLength(1);
    });
  });
}
