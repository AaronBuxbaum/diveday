"use client";

import { MINUTE_MS, nowMs } from "@/lib/clock";
import { beginLiveManifestShopRecovery, completeLiveManifestShopRecovery } from "./cache";

const MAX_RESPONSE_BYTES = 2048;
const RECOVERY_TIMEOUT_MS = 10_000;
const tagShape = /^[A-Za-z0-9_-]{43}$/;
type Scope = { shop: string; session: string };
type Challenge = Scope & { tombstone: string; nonce: string };

async function readResponse(response: Response, signal: AbortSignal): Promise<unknown> {
  if (!response.body) return null;
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const cancel = () => {
    void reader.cancel().catch(() => {});
  };
  signal.addEventListener("abort", cancel, { once: true });
  if (signal.aborted) cancel();
  let bytes = 0;
  let text = "";
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > MAX_RESPONSE_BYTES) {
        void reader.cancel().catch(() => {});
        return null;
      }
      text += decoder.decode(part.value, { stream: true });
    }
    return JSON.parse(text + decoder.decode());
  } catch {
    return null;
  } finally {
    signal.removeEventListener("abort", cancel);
    reader.releaseLock();
  }
}

function matches(
  value: unknown,
  challenge: Challenge,
  serverDate: number,
  elapsed: number,
): boolean {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const body = value as Record<string, unknown>;
  const keys = [
    "shopId",
    "sessionHandle",
    "tombstone",
    "nonce",
    "erasureEpoch",
    "issuedAt",
    "expiresAt",
    "proof",
  ];
  return (
    Object.keys(body).length === keys.length &&
    keys.every((key) => key in body) &&
    body.shopId === challenge.shop &&
    body.sessionHandle === challenge.session &&
    body.tombstone === challenge.tombstone &&
    body.nonce === challenge.nonce &&
    typeof body.proof === "string" &&
    tagShape.test(body.proof) &&
    typeof body.erasureEpoch === "number" &&
    Number.isSafeInteger(body.erasureEpoch) &&
    body.erasureEpoch >= 0 &&
    typeof body.issuedAt === "number" &&
    Number.isSafeInteger(body.issuedAt) &&
    typeof body.expiresAt === "number" &&
    Number.isSafeInteger(body.expiresAt) &&
    body.expiresAt > body.issuedAt &&
    body.expiresAt - body.issuedAt === MINUTE_MS &&
    Number.isFinite(serverDate) &&
    serverDate <= body.issuedAt &&
    body.issuedAt - serverDate < 1000 &&
    Number.isFinite(elapsed) &&
    elapsed >= 0 &&
    body.issuedAt + elapsed < body.expiresAt
  );
}

async function observe(challenge: Challenge, elapsed: () => number): Promise<boolean> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<false>((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      resolve(false);
    }, RECOVERY_TIMEOUT_MS);
  });
  try {
    const work = (async () => {
      const response = await fetch("/api/offline-manifests/recovery", {
        method: "POST",
        cache: "no-store",
        credentials: "same-origin",
        redirect: "error",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tombstone: challenge.tombstone, nonce: challenge.nonce }),
        signal: controller.signal,
      });
      if (
        controller.signal.aborted ||
        response.status !== 200 ||
        response.redirected ||
        !(response.headers.get("cache-control") ?? "")
          .split(",")
          .some((directive) => directive.trim().toLowerCase() === "no-store") ||
        (response.headers.get("content-type") ?? "").split(";", 1)[0]?.trim().toLowerCase() !==
          "application/json"
      )
        return false;
      const serverDate = Date.parse(response.headers.get("date") ?? "");
      const body = await readResponse(response, controller.signal);
      return !controller.signal.aborted && matches(body, challenge, serverDate, elapsed());
    })().catch(() => false);
    return await Promise.race([work, timeout]);
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}

/**
 * Reopens only a local erasure fence from the matching same-origin live
 * observation. This never validates or displays a cached roster or proof.
 */
export async function recoverLiveManifestShop(scope: Scope): Promise<boolean> {
  const captured = { ...scope };
  const wallStart = nowMs();
  const monoStart = performance.now();
  const elapsed = () => {
    const wall = nowMs() - wallStart;
    const mono = performance.now() - monoStart;
    return Number.isFinite(wall) && Number.isFinite(mono) && wall >= 0 && mono >= 0
      ? Math.max(wall, mono)
      : Number.POSITIVE_INFINITY;
  };
  const isCurrent = () => elapsed() < RECOVERY_TIMEOUT_MS;
  try {
    const recovery = await beginLiveManifestShopRecovery(captured);
    if (!isCurrent()) return false;
    return await completeLiveManifestShopRecovery(
      captured,
      recovery,
      (challenge) => observe(challenge, elapsed),
      isCurrent,
    );
  } catch {
    return false;
  }
}
