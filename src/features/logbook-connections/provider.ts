export type LogbookProvider = "garmin" | "suunto";

export type LogbookProviderConfig = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  /** Confirm against the approved Garmin portal; public specifications conflict. */
  garminTokenHost?: "diauth" | "connectapi";
};

export type LogbookTokens = {
  accessToken: string;
  refreshToken: string | null;
  expiresInSeconds: number;
  refreshExpiresInSeconds?: number;
  scope: string[];
};

export type LogbookIdentity = { externalId: string; permissions: string[] };

export type LogbookProviderErrorCode =
  | "invalid_configuration"
  | "invalid_input"
  | "invalid_response"
  | "unauthorized"
  | "forbidden"
  | "rate_limited"
  | "provider_unavailable"
  | "provider_rejected"
  | "timeout"
  | "network_error"
  | "documentation_required";

/** Never attach provider bodies, original exceptions, URLs or credentials. */
export class LogbookProviderError extends Error {
  constructor(public readonly code: LogbookProviderErrorCode) {
    super(code);
    this.name = "LogbookProviderError";
  }
}

export interface LogbookProviderAdapter {
  readonly id: LogbookProvider;
  authorizationUrl(
    config: LogbookProviderConfig,
    input: { state: string; codeChallenge?: string },
  ): string;
  exchangeCode(
    config: LogbookProviderConfig,
    input: { code: string; codeVerifier?: string },
    fetcher?: typeof fetch,
  ): Promise<LogbookTokens>;
  refresh(
    config: LogbookProviderConfig,
    input: { refreshToken: string },
    fetcher?: typeof fetch,
  ): Promise<LogbookTokens>;
  identify(
    config: LogbookProviderConfig,
    tokens: LogbookTokens,
    fetcher?: typeof fetch,
  ): Promise<LogbookIdentity>;
  revoke(
    config: LogbookProviderConfig,
    tokens: LogbookTokens,
    fetcher?: typeof fetch,
  ): Promise<{ remoteRevoked: boolean; manualRevocationRequired: boolean }>;
}
