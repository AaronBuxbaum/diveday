"use client";

import { useMemo, useSyncExternalStore } from "react";
import type { AgencyCheckQuery } from "@/lib/agency-check";
import {
  CHECK_REQUEST_TYPE,
  CHECK_RESULT_TYPE,
  CHECK_TIMEOUT_MS,
  DRY_RUN_REQUEST_TYPE,
  ELEARNING_REQUEST_TYPE,
  EXTENSION_MARKER_ATTRIBUTE,
  EXTENSION_MESSAGE_SOURCE,
  EXTENSION_READY_EVENT,
  type ExtensionCheckReply,
  type ExtensionDryRun,
  type ExtensionHello,
  type ExtensionPresence,
  extensionFailure,
  extensionPresence,
  extensionVersion,
  HELLO_REQUEST_TYPE,
  PADI_SESSION_REQUEST_TYPE,
  PAGE_MESSAGE_SOURCE,
  type PadiSession,
  parseExtensionDryRun,
  parseExtensionHello,
  parsePadiSession,
  SSI_MANUAL_REQUEST_TYPE,
  versionAtLeast,
} from "@/lib/cert-check-extension";
import type { ElearningQuery } from "@/lib/elearning-check";

function subscribe(onChange: () => void): () => void {
  window.addEventListener(EXTENSION_READY_EVENT, onChange);
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributeFilter: [EXTENSION_MARKER_ATTRIBUTE] });
  return () => {
    window.removeEventListener(EXTENSION_READY_EVENT, onChange);
    observer.disconnect();
  };
}

/**
 * Whether this browser has the DiveDay extension, and which copy: absent, or
 * a version older than `MIN_EXTENSION_VERSION`, or current. Absent on the
 * server and on the first client render, so the agency's plain link is what
 * paints first.
 */
export function useCertCheckExtensionPresence(): ExtensionPresence {
  const version = useSyncExternalStore(subscribe, extensionVersion, () => null);
  return useMemo(() => extensionPresence(version), [version]);
}

/**
 * Whether a check can be handed to the extension here: it is in this browser
 * and current. An older copy is treated as absent, so the agency's plain link
 * is what the staffer gets until it is updated.
 */
export function useCertCheckExtension(): boolean {
  return useCertCheckExtensionPresence().state === "current";
}

let nextRequest = 0;

/** Ask the extension to look one diver's card up, and wait for the page it read. */
export function requestAgencyPage(query: AgencyCheckQuery): Promise<ExtensionCheckReply> {
  if (query.agency === "ssi") {
    const version = extensionVersion();
    if (!version || !versionAtLeast(version, "1.6.0")) {
      return Promise.resolve({ ok: false, reason: "unsupported" });
    }
    return requestPage(SSI_MANUAL_REQUEST_TYPE, { ...query, cardNumber: null });
  }
  return requestPage(CHECK_REQUEST_TYPE, query);
}

/** Ask the extension to look one course student's eLearning up (H-106). */
export function requestElearningPage(query: ElearningQuery): Promise<ExtensionCheckReply> {
  return requestPage(ELEARNING_REQUEST_TYPE, query);
}

async function requestPage(type: string, query: object): Promise<ExtensionCheckReply> {
  const data = await requestExtension(type, query, CHECK_TIMEOUT_MS);
  if (!data) return { ok: false, reason: "timeout" };
  if (data.ok === true && typeof data.pageText === "string") {
    return { ok: true, pageText: data.pageText };
  }
  // A fixed code, never the page's words: "signed_out" is how a page behind
  // the shop's own sign-in says to sign in first. A page's shape comes only
  // if it parses as form words (`page-shape.ts`).
  return extensionFailure(data);
}

/** Ask which copy of the extension is here, or null when none answers in a moment. */
export async function requestExtensionHello(): Promise<ExtensionHello | null> {
  const data = await requestExtension(HELLO_REQUEST_TYPE, {}, 3_000);
  return data ? parseExtensionHello(data) : null;
}

/** "Try the checks": fill one agency's sample page in the extension, sending nothing anywhere. */
export async function requestDryRun(agency: string): Promise<ExtensionDryRun> {
  const data = await requestExtension(DRY_RUN_REQUEST_TYPE, { agency }, 15_000);
  return data ? parseExtensionDryRun(data) : { ok: false, reason: "timeout" };
}

/** "Try the checks": whether a PADI Pros' Site tab in this browser is signed in. */
export async function requestPadiSession(): Promise<PadiSession | null> {
  const data = await requestExtension(PADI_SESSION_REQUEST_TYPE, {}, 10_000);
  return data ? parsePadiSession(data) : null;
}

/**
 * One request to the extension and its answer, as the extension's own words
 * still to be read (each caller parses what it expects), or null when nothing
 * answered in time.
 */
function requestExtension(
  type: string,
  query: object,
  timeoutMs: number,
): Promise<Record<string, unknown> | null> {
  nextRequest += 1;
  const requestId = `check-${nextRequest}-${Math.random().toString(36).slice(2)}`;
  return new Promise((resolve) => {
    const timer = window.setTimeout(() => finish(null), timeoutMs);
    function finish(reply: Record<string, unknown> | null) {
      window.clearTimeout(timer);
      window.removeEventListener("message", onMessage);
      resolve(reply);
    }
    function onMessage(event: MessageEvent) {
      if (event.source !== window || event.origin !== window.location.origin) return;
      const data = event.data as Record<string, unknown> | null;
      if (
        !data ||
        data.source !== EXTENSION_MESSAGE_SOURCE ||
        data.type !== CHECK_RESULT_TYPE ||
        data.requestId !== requestId
      ) {
        return;
      }
      finish(data);
    }
    window.addEventListener("message", onMessage);
    window.postMessage(
      { source: PAGE_MESSAGE_SOURCE, type, requestId, query },
      window.location.origin,
    );
  });
}
