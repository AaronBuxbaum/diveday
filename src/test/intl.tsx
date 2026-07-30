import { render } from "@testing-library/react";
import type { ReactElement } from "react";
import { DiverIntlProvider } from "@/i18n/DiverIntlProvider";

/**
 * Render a diver-facing Client Component the way the app does — inside
 * `DiverIntlProvider`.
 *
 * `useTranslations` throws without a provider above it, so a bare `render()`
 * fails for any component that reads copy. That is the same failure the app
 * hits when a page forgets the provider, which makes this helper the honest
 * test setup rather than a workaround: components are exercised in the context
 * they actually run in.
 */
export function renderDiver(ui: ReactElement, locale = "en-US") {
  return render(
    <DiverIntlProvider locale={locale} timeZone="America/New_York">
      {ui}
    </DiverIntlProvider>,
  );
}
