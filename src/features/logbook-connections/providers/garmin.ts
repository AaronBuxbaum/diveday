import {
  type LogbookProviderAdapter,
  type LogbookProviderConfig,
  LogbookProviderError,
  type LogbookTokens,
} from "../provider";
import {
  boundedString,
  objectResponse,
  permissionList,
  providerRequest,
  requireInput,
  tokenResponse,
  validateConfig,
} from "./http";

/** Official OAuth2PKCE PDFs disagree on this hostname: configuration is mandatory. */
function tokenUrl(config: LogbookProviderConfig): string {
  validateConfig(config);
  if (config.garminTokenHost !== "diauth" && config.garminTokenHost !== "connectapi") {
    throw new LogbookProviderError("invalid_configuration");
  }
  return `https://${config.garminTokenHost}.garmin.com/di-oauth2-service/oauth/token`;
}

function bearer(tokens: LogbookTokens) {
  requireInput(tokens.accessToken);
  return { Authorization: `Bearer ${tokens.accessToken}` };
}

/** https://developerportal.garmin.com/sites/default/files/OAuth2PKCE_1.pdf */
export const garminProvider: LogbookProviderAdapter = {
  id: "garmin",
  authorizationUrl(config, input) {
    tokenUrl(config);
    requireInput(input.state, 512);
    if (!input.codeChallenge || !/^[A-Za-z0-9_-]{43}$/.test(input.codeChallenge)) {
      throw new LogbookProviderError("invalid_input");
    }
    const url = new URL("https://connect.garmin.com/oauth2Confirm");
    url.search = new URLSearchParams({
      response_type: "code",
      client_id: config.clientId,
      redirect_uri: config.redirectUri,
      state: input.state,
      code_challenge: input.codeChallenge,
      code_challenge_method: "S256",
    }).toString();
    return url.toString();
  },
  async exchangeCode(config, input, fetcher) {
    const url = tokenUrl(config);
    requireInput(input.code);
    if (!input.codeVerifier || !/^[A-Za-z0-9._~-]{43,128}$/.test(input.codeVerifier)) {
      throw new LogbookProviderError("invalid_input");
    }
    return tokenResponse(
      await providerRequest(
        url,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            Accept: "application/json",
          },
          body: new URLSearchParams({
            grant_type: "authorization_code",
            client_id: config.clientId,
            client_secret: config.clientSecret,
            redirect_uri: config.redirectUri,
            code: input.code,
            code_verifier: input.codeVerifier,
          }),
        },
        fetcher,
      ),
      true,
    );
  },
  async refresh(config, input, fetcher) {
    const url = tokenUrl(config);
    requireInput(input.refreshToken);
    return tokenResponse(
      await providerRequest(
        url,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            Accept: "application/json",
          },
          body: new URLSearchParams({
            grant_type: "refresh_token",
            client_id: config.clientId,
            client_secret: config.clientSecret,
            refresh_token: input.refreshToken,
          }),
        },
        fetcher,
      ),
      true,
    );
  },
  async identify(config, tokens, fetcher) {
    tokenUrl(config);
    const headers = bearer(tokens);
    const [identity, permissions] = await Promise.all([
      providerRequest("https://apis.garmin.com/wellness-api/rest/user/id", { headers }, fetcher),
      providerRequest(
        "https://apis.garmin.com/wellness-api/rest/user/permissions",
        { headers },
        fetcher,
      ),
    ]);
    const userId = objectResponse(identity).userId;
    if (!boundedString(userId, 512)) throw new LogbookProviderError("invalid_response");
    return { externalId: userId, permissions: permissionList(permissions) };
  },
  async revoke(config, tokens, fetcher) {
    tokenUrl(config);
    await providerRequest(
      "https://apis.garmin.com/wellness-api/rest/user/registration",
      { method: "DELETE", headers: bearer(tokens) },
      fetcher,
      false,
    );
    return { remoteRevoked: true, manualRevocationRequired: false };
  },
};
