"use client";

import { useRouter } from "next/navigation";
import { useActionState, useState } from "react";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import {
  controlClass,
  Field,
  FieldActions,
  FormStatus,
  textareaClassFor,
} from "@/components/ui/form";
import { fill, pluralForm } from "@/i18n/fill";
import type { PasteListState } from "../paste-list-actions";

/** The words a refused seat shows, by what refused it. */
export type PasteRefusalWord = "full" | "already" | "cards" | "course" | "busy" | "unavailable";

/**
 * Every refusal a seat can come back with, as the short word its row shows.
 * The trip's own notice for each says more; a list of fifteen wants a word.
 */
const REFUSAL_WORD: Record<string, PasteRefusalWord> = {
  trip_full: "full",
  divers_full: "full",
  date_request_party_full: "full",
  already_booked: "already",
  trip_prerequisite: "cards",
  course_unstaffed: "course",
  course_prerequisite: "course",
  course_ratio_full: "course",
  course_min_age: "course",
  busy: "busy",
};

/** A sentence with a count in it: `{count}` filled, one form or the other. */
type Counted = { one: string; other: string };

export type PasteListCopy = {
  listLabel: string;
  listDescription: string;
  chooseFile: string;
  fileUnreadable: string;
  read: string;
  reading: string;
  refused: Record<
    | "empty"
    | "too_large"
    | "too_many_columns"
    | "too_many_rows"
    | "cell_too_long"
    | "no_names"
    | "invalid",
    string
  >;
  /** "12 people to add". */
  toAdd: Counted;
  skipped: Counted;
  duplicates: Counted;
  /** The on-file choice's name for a reader: `{name}`. */
  whoLabel: string;
  newPerson: string;
  /** `{name}`, and `{name}` with `{contact}`. */
  onFile: string;
  onFileWith: string;
  droppedEmail: string;
  droppedPhone: string;
  /** Said above the add button: everybody on the list is about to be contacted. */
  linksGo: string;
  seat: Counted;
  seating: string;
  startOver: string;
  added: Counted;
  notAdded: Counted;
  reached: Record<"email" | "sms" | "whatsapp", string>;
  nothingSent: string;
  held: string;
  refusal: Record<PasteRefusalWord, string>;
  /** Closes the result and refreshes the guest list under it. */
  done: string;
};

function count(forms: Counted, value: number, locale: string): string {
  return fill(pluralForm(value, forms, locale), { count: value });
}

type Action = (state: PasteListState | undefined, formData: FormData) => Promise<PasteListState>;

/**
 * **Paste a list** on the departure's add band ("Try it Saturday", item 1):
 * paste rows (or choose a CSV file, which fills the box), read them into a
 * preview, settle who is on file, then add everybody. Each pass starts over
 * by remounting, so a second list never carries the first one's state.
 */
export function PasteListPanel({
  action,
  copy,
  locale,
  choiceField,
}: {
  action: Action;
  copy: PasteListCopy;
  locale: string;
  /** The field each person's choice posts under, once per person in list order. */
  choiceField: string;
}) {
  const [round, setRound] = useState(0);
  return (
    <PasteListRound
      key={round}
      action={action}
      copy={copy}
      locale={locale}
      choiceField={choiceField}
      restart={() => setRound((value) => value + 1)}
    />
  );
}

function PasteListRound({
  action,
  copy,
  locale,
  choiceField,
  restart,
}: {
  action: Action;
  copy: PasteListCopy;
  locale: string;
  choiceField: string;
  restart: () => void;
}) {
  const router = useRouter();
  const [state, formAction] = useActionState(action, undefined);
  const [text, setText] = useState("");
  const [fileFailed, setFileFailed] = useState(false);

  if (state?.step === "seated") {
    const seated = state.outcomes.filter((outcome) => outcome.ok);
    const refused = state.outcomes.filter((outcome) => !outcome.ok);
    return (
      <div className="flex flex-col gap-4" data-testid="paste-list-result">
        <p className="font-semibold">{count(copy.added, seated.length, locale)}</p>
        {seated.length > 0 ? (
          <ul className="flex flex-col gap-1 text-sm">
            {seated.map((outcome) => (
              <li key={outcome.row}>
                <span className="font-medium">{outcome.fullName}</span>
                <span className="text-muted">
                  {" · "}
                  {outcome.held
                    ? copy.held
                    : outcome.reached.length > 0
                      ? outcome.reached.map((channel) => copy.reached[channel]).join(", ")
                      : copy.nothingSent}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
        {refused.length > 0 ? (
          <>
            <p className="font-semibold">{count(copy.notAdded, refused.length, locale)}</p>
            <ul className="flex flex-col gap-1 text-sm" data-testid="paste-list-refused">
              {refused.map((outcome) => (
                <li key={outcome.row}>
                  <span className="font-medium">{outcome.fullName}</span>
                  <span className="text-muted">
                    {" · "}
                    {outcome.ok
                      ? null
                      : copy.refusal[REFUSAL_WORD[outcome.reason] ?? "unavailable"]}
                  </span>
                </li>
              ))}
            </ul>
          </>
        ) : null}
        <FieldActions>
          <button
            type="button"
            className={buttonClass({ variant: "secondary" })}
            onClick={() => {
              restart();
              router.refresh();
            }}
          >
            {copy.done}
          </button>
        </FieldActions>
      </div>
    );
  }

  if (state?.step === "preview") {
    return (
      <form action={formAction} className="flex flex-col gap-4" data-testid="paste-list-preview">
        <input type="hidden" name="step" value="seat" />
        <input type="hidden" name="list" value={state.text} />
        <div className="text-sm">
          <p className="font-semibold">{count(copy.toAdd, state.rows.length, locale)}</p>
          {state.skipped.length > 0 ? (
            <>
              <p className="text-muted">{count(copy.skipped, state.skipped.length, locale)}</p>
              <ul className="text-muted" data-testid="paste-list-skipped">
                {state.skipped.map((skip) => (
                  <li key={skip.row} className="break-words">
                    {skip.text}
                  </li>
                ))}
              </ul>
            </>
          ) : null}
          {state.duplicates > 0 ? (
            <p className="text-muted">{count(copy.duplicates, state.duplicates, locale)}</p>
          ) : null}
        </div>
        <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
          {state.rows.map((row) => (
            <li
              key={`${row.row}-${row.fullName}`}
              className="flex flex-col gap-2 px-3 py-3 sm:flex-row sm:items-start sm:justify-between"
            >
              <div className="min-w-0">
                <p className="font-medium break-words">{row.fullName}</p>
                {row.email || row.phone ? (
                  <p className="text-sm text-muted break-words">
                    {[row.email, row.phone].filter(Boolean).join(" · ")}
                  </p>
                ) : null}
                {row.dropped.includes("email") ? (
                  <p className="text-sm text-muted">{copy.droppedEmail}</p>
                ) : null}
                {row.dropped.includes("phone") ? (
                  <p className="text-sm text-muted">{copy.droppedPhone}</p>
                ) : null}
              </div>
              {row.candidates.length > 0 ? (
                <select
                  name={choiceField}
                  defaultValue={row.choice}
                  aria-label={fill(copy.whoLabel, { name: row.fullName })}
                  className={`${controlClass} sm:max-w-xs`}
                >
                  <option value="new">{copy.newPerson}</option>
                  {row.candidates.map((candidate) => (
                    <option key={candidate.id} value={candidate.id}>
                      {candidate.email || candidate.phone
                        ? fill(copy.onFileWith, {
                            name: candidate.fullName,
                            contact: candidate.email ?? candidate.phone ?? undefined,
                          })
                        : fill(copy.onFile, { name: candidate.fullName })}
                    </option>
                  ))}
                </select>
              ) : (
                <>
                  <input type="hidden" name={choiceField} value="new" />
                  <p className="text-sm text-muted">{copy.newPerson}</p>
                </>
              )}
            </li>
          ))}
        </ul>
        <p className="text-sm text-muted">{copy.linksGo}</p>
        <FieldActions>
          <SubmitButton pendingLabel={copy.seating} className={buttonClass()}>
            {count(copy.seat, state.rows.length, locale)}
          </SubmitButton>
          <button type="button" className={buttonClass({ variant: "secondary" })} onClick={restart}>
            {copy.startOver}
          </button>
        </FieldActions>
      </form>
    );
  }

  async function onFile(file: File | undefined) {
    if (!file) return;
    try {
      setText(await file.text());
      setFileFailed(false);
    } catch {
      setFileFailed(true);
    }
  }

  return (
    <form action={formAction} className="flex flex-col gap-4" data-testid="paste-list-form">
      <FormStatus tone="danger">
        {fileFailed
          ? copy.fileUnreadable
          : state?.step === "refused"
            ? copy.refused[state.reason]
            : undefined}
      </FormStatus>
      <input type="hidden" name="step" value="read" />
      <Field label={copy.listLabel} description={copy.listDescription}>
        <textarea
          name="list"
          required
          rows={6}
          value={text}
          onChange={(event) => setText(event.target.value)}
          className={textareaClassFor(6)}
          spellCheck={false}
        />
      </Field>
      <FieldActions>
        <SubmitButton pendingLabel={copy.reading} className={buttonClass()}>
          {copy.read}
        </SubmitButton>
        <label className={buttonClass({ variant: "secondary", className: "cursor-pointer" })}>
          {copy.chooseFile}
          <input
            type="file"
            accept=".csv,.tsv,.txt,text/csv,text/plain,text/tab-separated-values"
            className="sr-only"
            onChange={(event) => onFile(event.target.files?.[0])}
          />
        </label>
      </FieldActions>
    </form>
  );
}
