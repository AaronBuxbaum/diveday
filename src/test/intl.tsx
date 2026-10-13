import { render } from "@testing-library/react";
import type { ReactElement } from "react";
import { DiverIntlProvider } from "@/i18n/DiverIntlProvider";
import {
  type ClientDiverMessageNamespace,
  DIVER_MESSAGES,
  SERVER_ONLY_DIVER_NAMESPACES,
} from "@/i18n/messages";

/** Every namespace a client may be handed — the test default, so a test
 * doesn't have to enumerate namespaces just to keep `useTranslations()`
 * working; production call sites narrow this list for real (see
 * DiverIntlProvider.tsx's doc comment). The server-only namespaces are left
 * out here as the provider leaves them out. */
const ALL_DIVER_NAMESPACES = Object.keys(DIVER_MESSAGES["en-US"]).filter(
  (namespace) => !(SERVER_ONLY_DIVER_NAMESPACES as readonly string[]).includes(namespace),
) as ClientDiverMessageNamespace[];

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
  namespaces: readonly ClientDiverMessageNamespace[] = ALL_DIVER_NAMESPACES,
) {
  return render(
    <DiverIntlProvider locale={locale} timeZone="America/New_York" namespaces={namespaces}>
      {ui}
    </DiverIntlProvider>,
  );
}
