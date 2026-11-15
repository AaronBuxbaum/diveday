import { Buffer } from "node:buffer";
import { type LogbookProviderAdapter, LogbookProviderError } from "../provider";
import {
  boundedString,
  objectResponse,
  providerRequest,
  requireInput,
  tokenResponse,
  validateConfig,
} from "./http";

/** https://apizone.suunto.com/how-to-start — no undocumented refresh/revoke calls. */
export const suuntoProvider: LogbookProviderAdapter = {
  id: "suunto",
  authorizationUrl(config, input) {
    validateConfig(config);
    requireInput(input.state, 512);
    const url = new URL("https://cloudapi-oauth.suunto.com/oauth/authorize");
    url.search = new URLSearchParams({
      response_type: "code",
      client_id: config.clientId,
      redirect_uri: config.redirectUri,
      // State echo is a deployment verification gate: the public guide omits it.
      state: input.state,
    }).toString();
    return url.toString();
  },
  async exchangeCode(config, input, fetcher) {
    validateConfig(config);
    requireInput(input.code);
    if (config.clientId.includes(":")) throw new LogbookProviderError("invalid_configuration");
    const tokens = tokenResponse(
      await providerRequest(
        "https://cloudapi-oauth.suunto.com/oauth/token",
        {
          method: "POST",
          headers: {
            Authorization: `Basic ${Buffer.from(`${config.clientId}:${config.clientSecret}`).toString("base64")}`,
            "Content-Type": "application/x-www-form-urlencoded",
            Accept: "application/json",
          },
          body: new URLSearchParams({
            grant_type: "authorization_code",
            redirect_uri: config.redirectUri,
            code: input.code,
          }),
        },
        fetcher,
      ),
      false,
    );
    if (!tokens.scope.includes("workout")) throw new LogbookProviderError("invalid_response");
    return tokens;
  },
  async refresh() {
    throw new LogbookProviderError("documentation_required");
  },
  async identify(config, tokens) {
    validateConfig(config);
    requireInput(tokens.accessToken);
    const parts = tokens.accessToken.split(".");
    if (parts.length !== 3 || !parts.every((part) => /^[A-Za-z0-9_-]+$/.test(part))) {
      throw new LogbookProviderError("invalid_response");
    }
    let claims: Record<string, unknown>;
    try {
      const payload = Buffer.from(parts[1], "base64url");
      if (payload.byteLength > 8192 || payload.toString("base64url") !== parts[1]) {
        throw new LogbookProviderError("invalid_response");
      }
      claims = objectResponse(
        JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(payload)),
      );
    } catch {
      throw new LogbookProviderError("invalid_response");
    }
    if (!boundedString(claims.user, 512) || !tokens.scope.includes("workout")) {
      throw new LogbookProviderError("invalid_response");
    }
    // Correlation only, from the trusted HTTPS exchange response. This is not JWT
    // signature verification and must never authenticate a DiveDay user or webhook.
    return { externalId: claims.user, permissions: ["workout"] };
  },
  async revoke() {
    return { remoteRevoked: false, manualRevocationRequired: true };
  },
};
