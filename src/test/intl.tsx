import { render } from "@testing-library/react";
import type { ReactElement } from "react";
import { DiverIntlProvider } from "@/i18n/DiverIntlProvider";
import { DIVER_MESSAGES, type DiverMessageNamespace } from "@/i18n/messages";

/** Every namespace the bundle holds — the test default, so a test doesn't
 * have to enumerate namespaces just to keep `useTranslations()` working;
 * production call sites narrow this list for real (see
 * DiverIntlProvider.tsx's doc comment). */
const ALL_DIVER_NAMESPACES = Object.keys(DIVER_MESSAGES["en-US"]) as DiverMessageNamespace[];

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
export function renderDiver(
  ui: ReactElement,
  locale = "en-US",
  namespaces: readonly DiverMessageNamespace[] = ALL_DIVER_NAMESPACES,
) {
  return render(
    <DiverIntlProvider locale={locale} timeZone="America/New_York" namespaces={namespaces}>
      {ui}
    </DiverIntlProvider>,
  );
}
