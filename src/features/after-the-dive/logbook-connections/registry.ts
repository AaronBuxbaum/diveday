import {
  type LogbookProvider,
  type LogbookProviderAdapter,
  LogbookProviderError,
} from "./provider";
import { garminProvider } from "./providers/garmin";
import { suuntoProvider } from "./providers/suunto";

const providers: Record<LogbookProvider, LogbookProviderAdapter> = {
  garmin: garminProvider,
  suunto: suuntoProvider,
};

/** Protocol evidence, not a claim of partner approval, configuration or live interoperability. */
export function logbookProviderCapabilities(provider: LogbookProvider) {
  logbookProvider(provider);
  return {
    beta: true as const,
    authorizationCode: true,
    pkceDocumented: provider === "garmin",
    refreshDocumented: provider === "garmin",
    remoteRevocationDocumented: provider === "garmin",
    importEnabled: false as const,
  };
}

/** A runtime allowlist as well as a TypeScript union; never route credentials to an arbitrary host. */
export function logbookProvider(provider: unknown): LogbookProviderAdapter {
  if (provider !== "garmin" && provider !== "suunto")
    throw new LogbookProviderError("invalid_input");
  return providers[provider];
}

/**
 * Keys alone cannot establish schemas, paging, download URLs, webhook verification or erasure.
 * A future importer must replace this gate only alongside the approved contract and its tests.
 */
export function requireLogbookDataContract(provider: LogbookProvider): never {
  logbookProvider(provider);
  throw new LogbookProviderError("documentation_required");
}
