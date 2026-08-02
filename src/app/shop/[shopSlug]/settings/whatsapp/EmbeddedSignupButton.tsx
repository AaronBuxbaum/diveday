"use client";

import { useEffect, useRef, useState } from "react";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import type { FacebookSdk, SignupAction, SignupCopy } from "./signup-types";

/**
 * Launches Meta's **Embedded Signup** popup and hands what it returns to the
 * server (docs ADR 20260802-whatsapp-embedded-signup).
 *
 * The shop completes Meta's own hosted flow — choosing or creating a WhatsApp
 * Business Account and phone number, accepting Meta's terms — and this
 * component collects the three things that come back: a one-time authorization
 * code from the login callback, and the WABA and phone-number ids from a
 * `postMessage` Meta emits when the flow finishes. All three go to a server
 * action, which does the actual token exchange; nothing sensitive is minted or
 * held in the browser.
 *
 * Two ids, one code, two different channels — that is Meta's design, not ours,
 * and it is why this needs a client component at all rather than a plain form.
 *
 * Takes its words as props: staff copy is server-side only (AGENTS.md).
 */

declare global {
  interface Window {
    FB?: FacebookSdk;
    fbAsyncInit?: () => void;
  }
}

const SDK_SRC = "https://connect.facebook.net/en_US/sdk.js";
const SDK_ELEMENT_ID = "facebook-jssdk";

/**
 * Pinned to the same Graph version the send path uses. Session info v3 is
 * required: v2 of Embedded Signup is being retired by Meta in October 2026.
 */
const SDK_GRAPH_VERSION = "v23.0";

export function EmbeddedSignupButton({
  appId,
  configId,
  copy,
  action,
}: {
  appId: string;
  configId: string;
  copy: SignupCopy;
  /** Server action that exchanges the code; receives the three hidden fields. */
  action: SignupAction;
}) {
  const [ready, setReady] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  // Meta sends the ids and the code through two different channels that can
  // land in either order, so both are held until the pair is complete.
  const sessionRef = useRef<{ wabaId?: string; phoneNumberId?: string }>({});

  useEffect(() => {
    // The ids arrive by postMessage rather than in the login callback. Origin is
    // checked because any page can postMessage into this window.
    function onMessage(event: MessageEvent) {
      if (
        event.origin !== "https://www.facebook.com" &&
        event.origin !== "https://web.facebook.com"
      ) {
        return;
      }
      try {
        const parsed = typeof event.data === "string" ? JSON.parse(event.data) : event.data;
        if (parsed?.type !== "WA_EMBEDDED_SIGNUP") return;
        if (parsed.event === "FINISH" || parsed.event === "FINISH_ONLY_WABA") {
          sessionRef.current = {
            wabaId: parsed.data?.waba_id,
            phoneNumberId: parsed.data?.phone_number_id,
          };
        }
      } catch {
        // A non-JSON message from Facebook is not ours to interpret.
      }
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  useEffect(() => {
    if (window.FB) {
      setReady(true);
      return;
    }
    window.fbAsyncInit = () => {
      window.FB?.init({
        appId,
        autoLogAppEvents: true,
        xfbml: false,
        version: SDK_GRAPH_VERSION,
      });
      setReady(true);
    };
    if (document.getElementById(SDK_ELEMENT_ID)) return;
    const script = document.createElement("script");
    script.id = SDK_ELEMENT_ID;
    script.src = SDK_SRC;
    script.async = true;
    script.crossOrigin = "anonymous";
    document.body.appendChild(script);
  }, [appId]);

  function launch() {
    setNotice(null);
    const sdk = window.FB;
    if (!sdk) {
      setNotice(copy.blocked);
      return;
    }
    sdk.login(
      (response) => {
        const code = response.authResponse?.code;
        const { wabaId, phoneNumberId } = sessionRef.current;
        // A shop that closes the popup gets no code — not an error, just a
        // decision, so it reads as cancelled rather than a failure.
        if (!code || !wabaId || !phoneNumberId) {
          setNotice(copy.cancelled);
          return;
        }
        const form = formRef.current;
        if (!form) return;
        setField(form, "code", code);
        setField(form, "wabaId", wabaId);
        setField(form, "phoneNumberId", phoneNumberId);
        form.requestSubmit();
      },
      {
        config_id: configId,
        response_type: "code",
        override_default_response_type: true,
        extras: { setup: {}, featureType: "", sessionInfoVersion: "3" },
      },
    );
  }

  return (
    <div>
      <form ref={formRef} action={action}>
        <input type="hidden" name="code" />
        <input type="hidden" name="wabaId" />
        <input type="hidden" name="phoneNumberId" />
        {/* Rendered but not the button the shop presses: submission is driven by
            requestSubmit() once Meta's popup returns, while this keeps the
            pending state wired to the action the same way every other form does. */}
        <SubmitButton pendingLabel={copy.connecting} className="hidden">
          {copy.connect}
        </SubmitButton>
      </form>
      <button type="button" onClick={launch} disabled={!ready} className={buttonClass()}>
        {copy.connect}
      </button>
      {notice ? (
        <p className="mt-2 text-sm text-muted" role="status">
          {notice}
        </p>
      ) : null}
    </div>
  );
}

function setField(form: HTMLFormElement, name: string, value: string) {
  const field = form.elements.namedItem(name);
  if (field instanceof HTMLInputElement) field.value = value;
}
