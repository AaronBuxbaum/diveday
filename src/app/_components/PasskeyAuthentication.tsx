"use client";

import { startAuthentication } from "@simplewebauthn/browser";
import { useEffect, useState, useTransition } from "react";
import {
  beginPasskeySignInAction,
  beginPasskeyStepUpAction,
  completePasskeySignInAction,
  completePasskeyStepUpAction,
} from "@/app/actions/passkeys";
import { buttonClass } from "@/components/ui/button";
import { FormStatus } from "@/components/ui/form";
import { browserSupportsPasskeys } from "@/features/passkeys";

export function PasskeyAuthentication({
  label,
  pendingLabel,
  errorLabel,
  stepUp,
}: {
  label: string;
  pendingLabel: string;
  errorLabel: string;
  stepUp?: { shopSlug: string; purpose: string; returnTo: string };
}) {
  const [supported, setSupported] = useState(false);
  const [failed, setFailed] = useState(false);
  const [pending, startTransition] = useTransition();
  useEffect(() => {
    setSupported(browserSupportsPasskeys(window));
  }, []);
  if (!supported) return null;
  return (
    <div>
      <button
        type="button"
        disabled={pending}
        className={buttonClass({ variant: "link", flush: true })}
        onClick={() => {
          if (pending) return;
          setFailed(false);
          startTransition(async () => {
            try {
              const options = stepUp
                ? await beginPasskeyStepUpAction(stepUp.shopSlug, stepUp.purpose)
                : await beginPasskeySignInAction();
              if (!options) {
                setFailed(true);
                return;
              }
              const response = await startAuthentication({ optionsJSON: options });
              const result = stepUp
                ? await completePasskeyStepUpAction(
                    stepUp.shopSlug,
                    stepUp.purpose,
                    stepUp.returnTo,
                    response,
                  )
                : await completePasskeySignInAction(response);
              if (result === false) setFailed(true);
            } catch {
              setFailed(true);
            }
          });
        }}
      >
        {pending ? pendingLabel : label}
      </button>
      {failed ? <FormStatus tone="danger">{errorLabel}</FormStatus> : null}
    </div>
  );
}
