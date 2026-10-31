// Shared fixtures for the readiness worker's tests: the live page a navigation
// returns, and the snapshot the server answers when the worker asks for one.
import { vi } from "vitest";
import type { ReadySnapshot } from "@/lib/ready-offline";

export const NOW = 1_800_000_000_000;
export const DAY_MS = 24 * 60 * 60 * 1000;

/** A snapshot as the server builds it, with `body` as the saved page. */
export function snapshotOf(
  body = "<p>Ready</p>",
  overrides: Partial<ReadySnapshot> = {},
): ReadySnapshot {
  return {
    generatedAt: NOW,
    keepUntil: NOW + 30 * DAY_MS,
    saved: `<!doctype html><p>No signal.</p>${body}`,
    unverified: `<!doctype html><p>Clock not verified.</p>${body}`,
    rollback: "<!doctype html><h1>Phone clock looks wrong</h1>",
    ...overrides,
  };
}

/** The reply to `/ready/<token>/offline`: a snapshot, or any other response. */
export function stubSnapshotReply(reply: ReadySnapshot | Response | (() => Promise<Response>)) {
  const fetchMock = vi.fn<(input: unknown, init?: RequestInit) => Promise<Response>>(async () =>
    typeof reply === "function"
      ? reply()
      : reply instanceof Response
        ? reply.clone()
        : Response.json(reply),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

/** The live page the worker was handed; none of its body is ever stored. */
export function livePage(body = "<p>Live page</p>", init: ResponseInit = {}) {
  return new Response(body, {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8" },
    ...init,
  });
}

/**
 * A live page whose snapshot says `body`, with the server's answer already
 * stubbed. The stub replaces any earlier one, so build the page you are about
 * to save immediately before saving it.
 */
export function page(
  body = "<p>Ready</p>",
  init: ResponseInit = {},
  keepUntil = NOW + 30 * DAY_MS,
) {
  stubSnapshotReply(snapshotOf(body, { keepUntil }));
  return livePage(`<p>${body}</p>`, init);
}
