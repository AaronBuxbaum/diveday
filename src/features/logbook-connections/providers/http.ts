import {
  LogbookProviderError,
  type LogbookProviderErrorCode,
  type LogbookTokens,
} from "../provider";

const MAX_RESPONSE_BYTES = 65_536;
const REQUEST_TIMEOUT_MS = 10_000;
const MAX_TOKEN_LENGTH = 16_384;
const MAX_LIFETIME_SECONDS = 315_360_000;
const ENDPOINTS = new Set([
  "https://diauth.garmin.com/di-oauth2-service/oauth/token",
  "https://connectapi.garmin.com/di-oauth2-service/oauth/token",
  "https://apis.garmin.com/wellness-api/rest/user/id",
  "https://apis.garmin.com/wellness-api/rest/user/permissions",
  "https://apis.garmin.com/wellness-api/rest/user/registration",
  "https://cloudapi-oauth.suunto.com/oauth/token",
]);

export function boundedString(value: unknown, maximum = 512): value is string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: Reject header injection and control characters at the provider boundary.
  const controls = /[\u0000-\u0020\u007f]/;
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= maximum &&
    !controls.test(value)
  );
}

export function requireInput(value: unknown, maximum = MAX_TOKEN_LENGTH): asserts value is string {
  if (!boundedString(value, maximum)) throw new LogbookProviderError("invalid_input");
}

export function validateConfig(config: {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}) {
  if (!boundedString(config.clientId, 1024) || !boundedString(config.clientSecret, 4096)) {
    throw new LogbookProviderError("invalid_configuration");
  }
  try {
    const redirect = new URL(config.redirectUri);
    if (
      redirect.protocol !== "https:" ||
      redirect.username ||
      redirect.password ||
      redirect.hash ||
      config.redirectUri.length > 2048
    ) {
      throw new LogbookProviderError("invalid_configuration");
    }
  } catch {
    throw new LogbookProviderError("invalid_configuration");
  }
}

function statusCode(status: number): LogbookProviderErrorCode {
  if (status === 401) return "unauthorized";
  if (status === 403) return "forbidden";
  if (status === 429) return "rate_limited";
  if (status >= 500) return "provider_unavailable";
  return "provider_rejected";
}

async function readJson(response: Response, signal: AbortSignal): Promise<unknown> {
  const length = response.headers.get("content-length");
  if (length && (!/^\d+$/.test(length) || Number(length) > MAX_RESPONSE_BYTES)) {
    await response.body?.cancel();
    throw new LogbookProviderError("invalid_response");
  }
  if (!response.body) throw new LogbookProviderError("invalid_response");
  const reader = response.body.getReader();
  const cancel = () => {
    void reader.cancel().catch(() => undefined);
  };
  signal.addEventListener("abort", cancel, { once: true });
  if (signal.aborted) cancel();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > MAX_RESPONSE_BYTES) {
        void reader.cancel().catch(() => undefined);
        throw new LogbookProviderError("invalid_response");
      }
      chunks.push(chunk.value);
    }
  } finally {
    signal.removeEventListener("abort", cancel);
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let position = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, position);
    position += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new LogbookProviderError("invalid_response");
  }
}

/** Fixed documented endpoints only. Bounds include streaming the response body. */
export async function providerRequest(
  url: string,
  init: RequestInit,
  fetcher: typeof fetch = fetch,
  expectJson = true,
): Promise<unknown> {
  if (!ENDPOINTS.has(url)) throw new LogbookProviderError("invalid_configuration");
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new LogbookProviderError("timeout"));
    }, REQUEST_TIMEOUT_MS);
  });
  try {
    return await Promise.race([
      (async () => {
        const response = await fetcher(url, {
          ...init,
          redirect: "error",
          signal: controller.signal,
          cache: "no-store",
          credentials: "omit",
          referrerPolicy: "no-referrer",
        });
        if (response.redirected || (response.status >= 300 && response.status < 400)) {
          void response.body?.cancel().catch(() => undefined);
          throw new LogbookProviderError("provider_rejected");
        }
        if (!response.ok) {
          void response.body?.cancel().catch(() => undefined);
          throw new LogbookProviderError(statusCode(response.status));
        }
        if (!expectJson) {
          void response.body?.cancel().catch(() => undefined);
          // Accepted work has no completion proof; no documented polling endpoint exists.
          if (response.status === 202) throw new LogbookProviderError("invalid_response");
          return null;
        }
        return readJson(response, controller.signal);
      })(),
      deadline,
    ]);
  } catch (error) {
    if (controller.signal.aborted) throw new LogbookProviderError("timeout");
    if (error instanceof LogbookProviderError) throw error;
    throw new LogbookProviderError("network_error");
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}

export function objectResponse(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new LogbookProviderError("invalid_response");
  }
  return value as Record<string, unknown>;
}

function lifetime(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value > 0 &&
    value <= MAX_LIFETIME_SECONDS
  );
}

export function permissionList(value: unknown): string[] {
  if (
    !Array.isArray(value) ||
    value.length > 128 ||
    !value.every((entry) => boundedString(entry, 128) && /^[A-Za-z0-9_:./-]+$/.test(entry))
  ) {
    throw new LogbookProviderError("invalid_response");
  }
  return [...new Set(value)];
}

export function tokenResponse(value: unknown, requireRefresh: boolean): LogbookTokens {
  const response = objectResponse(value);
  if (
    !boundedString(response.access_token, MAX_TOKEN_LENGTH) ||
    typeof response.token_type !== "string" ||
    response.token_type.toLowerCase() !== "bearer" ||
    !lifetime(response.expires_in) ||
    typeof response.scope !== "string" ||
    response.scope.length > 4096 ||
    (response.refresh_token !== undefined &&
      !boundedString(response.refresh_token, MAX_TOKEN_LENGTH)) ||
    (requireRefresh && !boundedString(response.refresh_token, MAX_TOKEN_LENGTH)) ||
    (response.refresh_token_expires_in !== undefined &&
      !lifetime(response.refresh_token_expires_in))
  ) {
    throw new LogbookProviderError("invalid_response");
  }
  const scope = response.scope === "" ? [] : permissionList(response.scope.split(" "));
  return {
    accessToken: response.access_token,
    refreshToken: typeof response.refresh_token === "string" ? response.refresh_token : null,
    expiresInSeconds: response.expires_in,
    ...(response.refresh_token_expires_in === undefined
      ? {}
      : { refreshExpiresInSeconds: response.refresh_token_expires_in as number }),
    scope,
  };
}
