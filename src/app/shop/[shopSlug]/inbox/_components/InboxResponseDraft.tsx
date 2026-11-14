"use client";

import { useEffect, useId, useRef, useState } from "react";
import { AssistDraftButton } from "@/components/assists/AssistDraftButton";
import { Copyable } from "@/components/Copyable";
import { buttonClass } from "@/components/ui/button";
import { Field, textareaClassFor } from "@/components/ui/form";
import { mailtoHref } from "@/lib/contact-links";

/** Staff review the draft here. No send or booking action runs automatically. */
export function InboxResponseDraft({
  draft,
  email,
  subject,
  quoted,
  copy,
}: {
  draft: () => Promise<string | null>;
  email?: string;
  subject: string;
  quoted: string;
  copy: {
    draft: string;
    pending: string;
    empty: string;
    label: string;
    review: string;
    email: string;
    copy: string;
    copied: string;
    failed: string;
    changed: string;
  };
}) {
  const [text, setText] = useState<string | null>(null);
  const [changed, setChanged] = useState(false);
  const id = useId();
  const revision = useRef(0);
  const field = useRef<HTMLTextAreaElement>(null);
  const hasDraft = text !== null;
  useEffect(() => {
    if (hasDraft) field.current?.focus({ preventScroll: true });
  }, [hasDraft]);
  return (
    <div className={text === null ? undefined : "w-full space-y-3"}>
      <AssistDraftButton
        draft={async () => {
          setChanged(false);
          const startedAt = revision.current;
          const response = await draft();
          if (revision.current !== startedAt) {
            setChanged(true);
            return null;
          }
          return response;
        }}
        onDraft={setText}
        variant="primary"
        label={copy.draft}
        pendingLabel={copy.pending}
        emptyLabel={changed ? copy.changed : copy.empty}
      />
      {text === null && email ? (
        <a
          className={buttonClass({ variant: "secondary", size: "sm" })}
          href={mailtoHref(email, { subject, body: `\n\n${quoted}` })}
        >
          {copy.email}
        </a>
      ) : null}
      {text !== null ? (
        <>
          <Field label={copy.label} description={copy.review}>
            <textarea
              ref={field}
              id={id}
              className={textareaClassFor(6)}
              rows={6}
              value={text}
              onChange={(event) => {
                revision.current += 1;
                setText(event.target.value);
              }}
            />
          </Field>
          <div className="flex flex-wrap items-center gap-2">
            <Copyable
              value={text}
              layout="inline"
              copyLabel={copy.copy}
              copiedLabel={copy.copied}
              failedLabel={copy.failed}
            />
            {email ? (
              <a
                className={buttonClass({ variant: "secondary", size: "sm" })}
                href={mailtoHref(email, { subject, body: `${text}\n\n${quoted}` })}
              >
                {copy.email}
              </a>
            ) : null}
          </div>
        </>
      ) : null}
    </div>
  );
}
