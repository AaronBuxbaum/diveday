"use client";

import { startRegistration } from "@simplewebauthn/browser";
import { useEffect, useState, useTransition } from "react";
import {
  beginPasskeyRegistrationAction,
  completePasskeyRegistrationAction,
  deletePasskeyAction,
  renamePasskeyAction,
} from "@/app/actions/passkeys";
import { EmptyState } from "@/components/EmptyState";
import { buttonClass } from "@/components/ui/button";
import { controlClass, Field, FormStatus } from "@/components/ui/form";
import { browserSupportsPasskeys } from "@/features/passkeys";

export type PasskeyWords = Record<
  | "name"
  | "add"
  | "adding"
  | "save"
  | "delete"
  | "confirmDelete"
  | "cancel"
  | "empty"
  | "error"
  | "saved"
  | "unavailable",
  string
>;

export function PasskeySettings({
  locked,
  shopSlug,
  passkeys,
  words,
}: {
  locked: boolean;
  shopSlug: string;
  passkeys: { id: string; name: string; lastUsed: string }[];
  words: PasskeyWords;
}) {
  const [supported, setSupported] = useState(false);
  const [pending, startTransition] = useTransition();
  const [status, setStatus] = useState<"saved" | "error" | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  useEffect(() => {
    setSupported(browserSupportsPasskeys(window));
  }, []);
  function change(action: () => Promise<boolean>) {
    if (pending) return;
    setStatus(null);
    startTransition(async () => {
      try {
        setStatus((await action()) ? "saved" : "error");
      } catch {
        setStatus("error");
      }
    });
  }
  return (
    <div className="space-y-5">
      {passkeys.length ? (
        <ul className="divide-y divide-border">
          {passkeys.map((key) => (
            <li key={key.id} className="space-y-2 py-3 first:pt-0">
              <form
                className="flex flex-wrap items-end gap-3"
                onSubmit={(event) => {
                  event.preventDefault();
                  const form = new FormData(event.currentTarget);
                  change(() =>
                    renamePasskeyAction(shopSlug, key.id, String(form.get("name") ?? "")),
                  );
                }}
              >
                <Field label={words.name}>
                  <input
                    name="name"
                    defaultValue={key.name}
                    required
                    maxLength={80}
                    className={controlClass}
                  />
                </Field>
                <button
                  type="submit"
                  disabled={pending}
                  className={buttonClass({ variant: "secondary" })}
                >
                  {words.save}
                </button>
                <button
                  type="button"
                  disabled={pending || locked}
                  className={buttonClass({ variant: "link" })}
                  onClick={() => setDeleting(key.id)}
                >
                  {words.delete}
                </button>
              </form>
              <p className="text-sm text-muted">{key.lastUsed}</p>
              {deleting === key.id ? (
                <div className="flex flex-wrap gap-3">
                  <button
                    type="button"
                    disabled={pending}
                    className={buttonClass({ variant: "danger" })}
                    onClick={() =>
                      change(async () => {
                        const result = await deletePasskeyAction(shopSlug, key.id);
                        if (result) setDeleting(null);
                        return result;
                      })
                    }
                  >
                    {words.confirmDelete}
                  </button>
                  <button
                    type="button"
                    className={buttonClass({ variant: "link" })}
                    onClick={() => setDeleting(null)}
                  >
                    {words.cancel}
                  </button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState title={words.empty} titleAs="h3" nested icon={false} />
      )}
      {supported ? (
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            const element = event.currentTarget;
            change(async () => {
              const options = await beginPasskeyRegistrationAction(shopSlug);
              if (!options) return false;
              const response = await startRegistration({ optionsJSON: options });
              const accepted = await completePasskeyRegistrationAction(
                shopSlug,
                response,
                String(form.get("name") ?? ""),
              );
              if (accepted) element.reset();
              return accepted;
            });
          }}
        >
          <Field label={words.name}>
            <input
              name="name"
              required
              maxLength={80}
              autoComplete="off"
              className={controlClass}
            />
          </Field>
          <button
            type="submit"
            disabled={pending || locked}
            className={buttonClass({ variant: "secondary" })}
          >
            {pending ? words.adding : words.add}
          </button>
        </form>
      ) : (
        <p className="text-sm text-muted">{words.unavailable}</p>
      )}
      {status ? (
        <FormStatus tone={status === "error" ? "danger" : "success"}>{words[status]}</FormStatus>
      ) : null}
    </div>
  );
}
