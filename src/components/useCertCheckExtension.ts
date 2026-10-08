"use client";

import { useSyncExternalStore } from "react";
import type { AgencyCheckQuery } from "@/lib/agency-check";
import {
  CHECK_REQUEST_TYPE,
  CHECK_RESULT_TYPE,
  CHECK_TIMEOUT_MS,
  EXTENSION_MARKER_ATTRIBUTE,
  EXTENSION_MESSAGE_SOURCE,
  EXTENSION_READY_EVENT,
  type ExtensionCheckReply,
  extensionVersion,
  PAGE_MESSAGE_SOURCE,
} from "@/lib/cert-check-extension";

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
 * Whether the DiveDay browser extension is in this browser. Always false on
 * the server and on the first client render, so the agency's plain link is
 * what paints first and what stays when there is no extension.
 */
export function useCertCheckExtension(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => extensionVersion() !== null,
    () => false,
  );
}

let nextRequest = 0;

/** Ask the extension to look one diver up, and wait for the page it read. */
export function requestAgencyPage(query: AgencyCheckQuery): Promise<ExtensionCheckReply> {
  nextRequest += 1;
  const requestId = `check-${nextRequest}-${Math.random().toString(36).slice(2)}`;
  return new Promise((resolve) => {
    const timer = window.setTimeout(
      () => finish({ ok: false, reason: "timeout" }),
      CHECK_TIMEOUT_MS,
    );
    function finish(reply: ExtensionCheckReply) {
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
      if (data.ok === true && typeof data.pageText === "string") {
        finish({ ok: true, pageText: data.pageText });
      } else {
        finish({ ok: false, reason: "fill_failed" });
      }
    }
    window.addEventListener("message", onMessage);
    window.postMessage(
      { source: PAGE_MESSAGE_SOURCE, type: CHECK_REQUEST_TYPE, requestId, query },
      window.location.origin,
    );
  });
}
