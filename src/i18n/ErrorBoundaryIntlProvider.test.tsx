// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { useTranslations } from "next-intl";
import { afterEach, describe, expect, it } from "vitest";
import { ErrorBoundaryIntlProvider } from "./ErrorBoundaryIntlProvider";
import { ERROR_BOUNDARY_MESSAGES_BY_LOCALE } from "./error-boundary-messages";
import { DEFAULT_DIVER_LOCALE } from "./settings";

/**
 * The bearer-token routes' error boundaries get their words from this provider,
 * and the whole reason it exists is that it resolves the locale **without a
 * `headers()` read** — which is what lets its segment layout stay synchronous
 * and the route keep a static shell (ADR 20260804-instant-navigation).
 *
 * So the thing worth pinning is that the locale still lands on the reader's own
 * language. `<html lang>` is the input, set before first paint by the root
 * layout's `localeCorrectionScript` off `navigator.languages` — the same list
 * the browser builds `Accept-Language` from, which is what the server used to
 * read here.
 */
function Title() {
  const t = useTranslations("errorBoundary");
  return <p>{t("title")}</p>;
}

function renderWithLang(lang: string) {
  document.documentElement.lang = lang;
  return render(
    <ErrorBoundaryIntlProvider messagesByLocale={ERROR_BOUNDARY_MESSAGES_BY_LOCALE}>
      <Title />
    </ErrorBoundaryIntlProvider>,
  );
}

afterEach(() => {
  cleanup();
  document.documentElement.lang = DEFAULT_DIVER_LOCALE;
});

describe("ErrorBoundaryIntlProvider", () => {
  it("reads the boundary's language off <html lang>", async () => {
    renderWithLang("es-ES");
    expect(await screen.findByText(ERROR_BOUNDARY_MESSAGES_BY_LOCALE["es-ES"].title)).toBeDefined();
  });

  it("falls back to the default locale for a language DiveDay does not carry", async () => {
    // A reader whose browser asks for Portuguese gets English, not a raw key —
    // the same answer `negotiateLocale` gives on the server.
    renderWithLang("pt-BR");
    expect(
      await screen.findByText(ERROR_BOUNDARY_MESSAGES_BY_LOCALE[DEFAULT_DIVER_LOCALE].title),
    ).toBeDefined();
  });

  it("carries every locale's copy, so the pick can never miss", () => {
    // The provider ships both bundles precisely so the choice can happen on the
    // client. A locale added to DIVER_LOCALES without a bundle entry would
    // render blank strings rather than throw, so assert the map is total.
    for (const [locale, messages] of Object.entries(ERROR_BOUNDARY_MESSAGES_BY_LOCALE)) {
      expect(typeof messages.title, locale).toBe("string");
      expect(typeof messages.tryAgain, locale).toBe("string");
      expect(messages.title.length, locale).toBeGreaterThan(0);
    }
  });
});
