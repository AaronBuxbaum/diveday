import Anthropic from "@anthropic-ai/sdk";

/**
 * **The provider seam** (ADR 20261018-claude-assists), shaped like every other
 * external seam here: an interface the domain is written against, one real
 * implementation over `@anthropic-ai/sdk`, and a fake for tests
 * (`fakeClaude` in `src/test/fakes.ts`). The request and response are the
 * SDK's own types, so a fake answers in exactly the shape the API does.
 */
export type ClaudeRequest = Anthropic.MessageCreateParamsNonStreaming;
export type ClaudeMessage = Anthropic.Message;

export interface ClaudeProvider {
  createMessage(request: ClaudeRequest): Promise<ClaudeMessage>;
}

/**
 * Long enough for a Sonnet call that reads a few pages of a shop's website,
 * short enough that a stuck call never holds a server action open for long.
 * The SDK retries once (429, 5xx, connection) before the assist goes dark.
 */
export const CLAUDE_TIMEOUT_MS = 90_000;
const CLAUDE_MAX_RETRIES = 1;

/**
 * Pinned, so an `ANTHROPIC_BASE_URL` left in an environment can never send a
 * shop's messages somewhere other than Anthropic.
 */
const ANTHROPIC_API_URL = "https://api.anthropic.com";

/** The real provider over one API key. */
export function anthropicProvider(apiKey: string): ClaudeProvider {
  const client = new Anthropic({
    apiKey,
    baseURL: ANTHROPIC_API_URL,
    maxRetries: CLAUDE_MAX_RETRIES,
    timeout: CLAUDE_TIMEOUT_MS,
  });
  return { createMessage: (request) => client.messages.create(request) };
}

/**
 * The provider for this deployment, or null when there is no key. The key is
 * read from `ANTHROPIC_API_KEY` only: the SDK's other credential sources (CLI
 * profiles, federation) are for a developer's machine, not a server.
 */
export function claudeProviderFromEnv(
  env: Readonly<Record<string, string | undefined>> = process.env,
): ClaudeProvider | null {
  const key = env.ANTHROPIC_API_KEY?.trim();
  return key ? anthropicProvider(key) : null;
}

/**
 * A failed call as a machine code for the usage row and the log line: never
 * the error's message, which can quote the request back.
 */
export function claudeErrorCode(error: unknown): string {
  if (error instanceof Anthropic.APIConnectionTimeoutError) return "timeout";
  if (error instanceof Anthropic.APIConnectionError) return "connection";
  if (error instanceof Anthropic.APIError && typeof error.status === "number") {
    return `http_${error.status}`;
  }
  return "unknown";
}
