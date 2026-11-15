"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useEffect, useRef, useState, useTransition } from "react";
import { EmptyState } from "@/components/EmptyState";
import { buttonClass } from "@/components/ui/button";
import { ChoiceRow, controlClass, Field, FormStatus, textareaClassFor } from "@/components/ui/form";
import { SECTION_TITLE_CLASS } from "@/components/ui/typography";
import type { StaffMessages } from "@/i18n/staff-messages";
import type { ParsedComputerDive } from "@/lib/computer-import";
import { changeAction, commitAction, exportAction, previewAction } from "./computer-actions";

type Copy = StaffMessages["computerDives"];
type Preview = Extract<Awaited<ReturnType<typeof previewAction>>, { ok: true }>["value"];
type HistoryDive = {
  id: string;
  record: ParsedComputerDive;
  annotation: string;
  deletedAt: Date | null;
};

function Fact({
  label,
  value,
  unknown,
}: {
  label: string;
  value: string | number | null | undefined;
  unknown: string;
}) {
  return (
    <div>
      <dt className="text-sm text-muted">{label}</dt>
      <dd className="break-words">{value ?? unknown}</dd>
    </div>
  );
}

/** A bounded polyline preserves the shape; exact samples remain in the authorized export. */
function Profile({ record, copy }: { record: ParsedComputerDive; copy: Copy }) {
  if (!record.samples.length) return <p className="text-sm text-muted">{copy.noProfile}</p>;
  const maxSeconds = Math.max(1, ...record.samples.map((sample) => sample.seconds));
  const maxDepth = Math.max(1, ...record.samples.map((sample) => sample.depthMeters));
  const stride = Math.max(1, Math.ceil(record.samples.length / 400));
  const points = record.samples
    .filter((_, index) => index % stride === 0 || index === record.samples.length - 1)
    .map(
      (sample) =>
        `${10 + (sample.seconds / maxSeconds) * 580},${10 + (sample.depthMeters / maxDepth) * 160}`,
    )
    .join(" ");
  return (
    <figure>
      <figcaption className="text-sm font-medium">{copy.profile}</figcaption>
      <svg
        role="img"
        aria-label={copy.profile}
        viewBox="0 0 600 190"
        className="mt-2 w-full rounded-lg bg-surface-sunken"
      >
        <title>{copy.profile}</title>
        <path d="M10 10V170H590" fill="none" stroke="currentColor" className="text-border-strong" />
        <polyline
          points={points}
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          className="text-primary"
        />
      </svg>
      <p className="flex justify-between text-sm text-muted">
        <span>
          {copy.seconds}: 0–{maxSeconds}
        </span>
        <span>
          {copy.meters}: 0–{maxDepth}
        </span>
      </p>
      <p className="text-sm text-muted">
        {copy.samples}: {record.samples.length}
      </p>
    </figure>
  );
}

function RecordDetails({ record, copy }: { record: ParsedComputerDive; copy: Copy }) {
  return (
    <div className="space-y-6">
      <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Fact label={copy.localStart} value={record.localStart} unknown={copy.unknown} />
        <Fact
          label={copy.zone}
          value={record.offsetMinutes === null ? null : `${copy.offset}: ${record.offsetMinutes}`}
          unknown={copy.unknown}
        />
        <Fact label={copy.instant} value={record.startInstant} unknown={copy.unknown} />
        <Fact label={copy.duration} value={record.durationSeconds} unknown={copy.unknown} />
        <Fact label={copy.depth} value={record.maxDepthMeters} unknown={copy.unknown} />
        <Fact label={copy.device} value={record.device} unknown={copy.unknown} />
        <Fact label={copy.deviceId} value={record.deviceId} unknown={copy.unknown} />
        <Fact label={copy.recordingIndex} value={record.recordingIndex} unknown={copy.unknown} />
        <Fact label={copy.source} value={record.sourceFormat} unknown={copy.unknown} />
        <Fact label={copy.sourceId} value={record.sourceId} unknown={copy.unknown} />
        <Fact
          label={copy.units}
          value={Object.values(record.sourceUnits).filter(Boolean).join(", ")}
          unknown={copy.unknown}
        />
      </dl>
      <Profile record={record} copy={copy} />
      {record.gases.length ? (
        <div>
          <h3 className="font-medium">{copy.gases}</h3>
          {record.gases.map((gas) => (
            <dl key={gas.id} className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-3">
              <Fact label={copy.gasId} value={gas.id} unknown={copy.unknown} />
              <Fact label={copy.oxygen} value={gas.oxygenFraction} unknown={copy.unknown} />
              <Fact label={copy.helium} value={gas.heliumFraction} unknown={copy.unknown} />
            </dl>
          ))}
        </div>
      ) : null}
      {record.tanks.length ? (
        <div>
          <h3 className="font-medium">{copy.tanks}</h3>
          {record.tanks.map((tank, index) => (
            <dl
              // biome-ignore lint/suspicious/noArrayIndexKey: Tanks have no source id; this immutable recording preserves source order.
              key={`${tank.gasId}-${index}`}
              className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2"
            >
              <Fact label={copy.gasId} value={tank.gasId} unknown={copy.unknown} />
              <Fact label={copy.volume} value={tank.volumeLiters} unknown={copy.unknown} />
              <Fact
                label={copy.startPressure}
                value={tank.startPressureBar}
                unknown={copy.unknown}
              />
              <Fact label={copy.endPressure} value={tank.endPressureBar} unknown={copy.unknown} />
            </dl>
          ))}
        </div>
      ) : null}
      {record.warnings.length ? (
        <div>
          <h3 className="font-medium">{copy.warnings}</h3>
          <ul className="list-inside list-disc text-sm text-warning-strong">
            {record.warnings.map((warning) => (
              <li key={warning}>
                {copy.warningCodes[warning as keyof Copy["warningCodes"]] ?? warning}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function PreviewFacts({ record, copy }: { record: ParsedComputerDive; copy: Copy }) {
  return (
    <div className="space-y-3">
      <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Fact
          label={copy.zone}
          value={record.offsetMinutes === null ? null : `${copy.offset}: ${record.offsetMinutes}`}
          unknown={copy.unknown}
        />
        <Fact label={copy.duration} value={record.durationSeconds} unknown={copy.unknown} />
        <Fact label={copy.depth} value={record.maxDepthMeters} unknown={copy.unknown} />
        <Fact label={copy.samples} value={record.samples.length} unknown={copy.unknown} />
        <Fact
          label={copy.units}
          value={Object.values(record.sourceUnits).filter(Boolean).join(", ")}
          unknown={copy.unknown}
        />
      </dl>
      {record.warnings.length ? (
        <ul className="list-inside list-disc text-sm text-warning-strong">
          {record.warnings.map((warning) => (
            <li key={warning}>
              {copy.warningCodes[warning as keyof Copy["warningCodes"]] ?? warning}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function useComputerDives(shopSlug: string, personId: string) {
  const router = useRouter();
  const [files, setFiles] = useState<File[]>([]);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [reviewed, setReviewed] = useState<Set<string>>(new Set());
  const [offsets, setOffsets] = useState<Record<string, string>>({});
  const [confirmed, setConfirmed] = useState(false);
  const [requestKey, setRequestKey] = useState("");
  const [result, setResult] = useState<{ imported: number; skipped: number } | null>(null);
  const [error, setError] = useState(0);
  const [saved, setSaved] = useState(0);
  const [pending, startTransition] = useTransition();
  const busy = useRef(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const returnToFiles = useRef(false);
  const previewHeading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (preview) previewHeading.current?.focus();
    else if (returnToFiles.current) {
      fileInput.current?.focus();
      returnToFiles.current = false;
    }
  }, [preview]);
  const run = (action: () => Promise<void>) => {
    if (busy.current) return;
    busy.current = true;
    startTransition(async () => {
      try {
        await action();
      } catch {
        setError((value) => value + 1);
      } finally {
        busy.current = false;
      }
    });
  };
  const reset = () => {
    returnToFiles.current = true;
    setPreview(null);
    setFiles([]);
    setSelected(new Set());
    setReviewed(new Set());
    setOffsets({});
    setConfirmed(false);
    setRequestKey("");
    setResult(null);
    if (fileInput.current) fileInput.current.value = "";
  };
  const payload = () => {
    const data = new FormData();
    for (const file of files) data.append("files", file);
    return data;
  };
  const onPreview = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    run(async () => {
      const response = await previewAction(shopSlug, personId, payload());
      if (!response.ok) {
        setError((value) => value + 1);
        return;
      }
      setPreview(response.value);
      setSelected(
        new Set(response.value.dives.filter((dive) => !dive.duplicate).map((dive) => dive.key)),
      );
      setRequestKey(crypto.randomUUID());
      setResult(null);
    });
  };
  const ready = confirmed && selected.size > 0 && [...selected].every((key) => reviewed.has(key));
  const onCommit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!ready) return;
    run(async () => {
      const data = payload();
      data.set("requestKey", requestKey);
      data.set("confirmedPersonId", personId);
      const timeOffsets: Record<string, number | null> = {};
      for (const key of selected) {
        data.append("selected", key);
        timeOffsets[key] = offsets[key]?.trim() ? Number(offsets[key]) : null;
      }
      data.set("timeOffsets", JSON.stringify(timeOffsets));
      const response = await commitAction(shopSlug, personId, data);
      if (!response.ok) {
        setError((value) => value + 1);
        return;
      }
      setResult(response.value);
      router.refresh();
    });
  };
  const change = () => {
    setRequestKey(crypto.randomUUID());
    setResult(null);
  };
  const mutate = (dive: HistoryDive, intent: "note" | "delete" | "restore", note = "") =>
    run(async () => {
      const response = await changeAction(shopSlug, personId, dive.id, intent, note);
      if (!response.ok) {
        setError((value) => value + 1);
        return;
      }
      setSaved((value) => value + 1);
      router.refresh();
    });
  const download = () =>
    run(async () => {
      const response = await exportAction(shopSlug, personId);
      if (!response.ok) {
        setError((value) => value + 1);
        return;
      }
      const url = URL.createObjectURL(new Blob([response.value], { type: "application/json" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = "computer-dives.json";
      link.click();
      URL.revokeObjectURL(url);
    });
  return {
    files,
    setFiles,
    preview,
    selected,
    setSelected,
    reviewed,
    setReviewed,
    offsets,
    setOffsets,
    confirmed,
    setConfirmed,
    result,
    setResult,
    error,
    saved,
    pending,
    fileInput,
    previewHeading,
    reset,
    onPreview,
    ready,
    onCommit,
    change,
    mutate,
    download,
  };
}

function HistoryLedger({
  canExport,
  history,
  copy,
  pending,
  download,
  mutate,
}: {
  history: HistoryDive[];
  canExport: boolean;
  copy: Copy;
  pending: boolean;
  download: () => void;
  mutate: (dive: HistoryDive, intent: "note" | "delete" | "restore", note?: string) => void;
}) {
  return (
    <section aria-labelledby="computer-history" className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="computer-history" className={SECTION_TITLE_CLASS}>
          {copy.history}
        </h2>
        {canExport ? (
          <button
            type="button"
            onClick={download}
            disabled={pending}
            className={buttonClass({ variant: "secondary" })}
          >
            {copy.export}
          </button>
        ) : null}
      </div>
      {canExport ? <p className="text-sm text-muted">{copy.exportHint}</p> : null}
      {!history.length ? (
        <EmptyState title={copy.empty} titleAs="h3" icon={false} />
      ) : (
        history.map((dive) => (
          <details key={dive.id} className="border-t border-border">
            <summary className="min-h-12 cursor-pointer py-3 font-medium">
              {dive.record.localStart} · {dive.record.device ?? copy.unknown}
              {dive.deletedAt ? ` · ${copy.deleted}` : ""}
            </summary>
            <div className="space-y-6 pb-6">
              <RecordDetails record={dive.record} copy={copy} />
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  const value = new FormData(event.currentTarget).get("annotation");
                  mutate(dive, "note", typeof value === "string" ? value : "");
                }}
                className="space-y-3"
              >
                <Field label={copy.notes} htmlFor={`note-${dive.id}`}>
                  <textarea
                    key={dive.annotation}
                    id={`note-${dive.id}`}
                    name="annotation"
                    defaultValue={dive.annotation}
                    maxLength={2000}
                    rows={3}
                    className={textareaClassFor(3)}
                    disabled={pending}
                  />
                </Field>
                <div className="flex flex-wrap gap-3">
                  <button
                    type="submit"
                    disabled={pending}
                    className={buttonClass({ variant: "secondary" })}
                  >
                    {copy.save}
                  </button>
                  <button
                    type="button"
                    onClick={() => mutate(dive, dive.deletedAt ? "restore" : "delete")}
                    disabled={pending}
                    className={buttonClass({ variant: "secondary" })}
                  >
                    {dive.deletedAt ? copy.restore : copy.delete}
                  </button>
                </div>
              </form>
            </div>
          </details>
        ))
      )}
    </section>
  );
}

export function ComputerDives({
  canExport = false,
  shopSlug,
  personId,
  personName,
  history,
  copy,
}: {
  canExport?: boolean;
  shopSlug: string;
  personId: string;
  personName: string;
  history: HistoryDive[];
  copy: Copy;
}) {
  const {
    files,
    setFiles,
    preview,
    selected,
    setSelected,
    reviewed,
    setReviewed,
    offsets,
    setOffsets,
    confirmed,
    setConfirmed,
    result,
    setResult,
    error,
    saved,
    pending,
    fileInput,
    previewHeading,
    reset,
    onPreview,
    ready,
    onCommit,
    change,
    mutate,
    download,
  } = useComputerDives(shopSlug, personId);
  const hasFileErrors = preview?.files.some((file) => file.error);
  return (
    <div className="mt-6 space-y-10">
      {error > 0 ? <FormStatus occurrenceKey={error}>{copy.error}</FormStatus> : null}
      {saved > 0 ? (
        <FormStatus tone="success" occurrenceKey={saved}>
          {copy.saved}
        </FormStatus>
      ) : null}
      <section className="space-y-5">
        <p>{copy.intro}</p>
        <p className="text-sm text-muted">{copy.formats}</p>
        <a
          href={`/shop/${shopSlug}/divers/${personId}/computer-dives/template`}
          download
          className={buttonClass({ variant: "secondary" })}
        >
          {copy.template}
        </a>
        <form onSubmit={onPreview} className="space-y-4">
          <Field label={copy.files} htmlFor="computer-files" description={copy.limit}>
            <input
              ref={fileInput}
              id="computer-files"
              type="file"
              multiple
              disabled={pending || preview !== null}
              className={controlClass}
              onChange={(event) => {
                setFiles(Array.from(event.target.files ?? []));
                setResult(null);
              }}
            />
          </Field>
          <div className="flex flex-wrap gap-3">
            <button
              type="submit"
              className={buttonClass({ variant: "secondary" })}
              disabled={pending || !files.length || preview !== null}
            >
              {pending ? copy.busy : copy.preview}
            </button>
          </div>
        </form>
      </section>
      {preview ? (
        <section aria-labelledby="computer-preview" className="space-y-5">
          <h2
            id="computer-preview"
            tabIndex={-1}
            ref={previewHeading}
            className={SECTION_TITLE_CLASS}
          >
            {copy.previewHeading}
          </h2>
          <p className="text-sm text-muted">{copy.previewOnly}</p>
          <dl className="text-sm">
            <dt className="text-muted">{copy.target}</dt>
            <dd className="font-medium">{preview.personName}</dd>
          </dl>
          {hasFileErrors ? (
            <div>
              <h3 className="font-medium">{copy.fileErrors}</h3>
              <ul className="list-inside list-disc text-sm text-warning-strong">
                {preview.files
                  .filter((file) => file.error)
                  .map((file, index) => (
                    // biome-ignore lint/suspicious/noArrayIndexKey: Repeated file names are valid in this immutable preview.
                    <li key={`${file.name}-${index}`}>
                      {file.name}:{" "}
                      {copy.fileErrorCodes[file.error as keyof Copy["fileErrorCodes"]] ??
                        copy.fileError}
                    </li>
                  ))}
              </ul>
            </div>
          ) : null}
          <form onSubmit={onCommit} className="space-y-6">
            <p className="text-sm text-muted">{copy.selectionHint}</p>
            {preview.dives.map((dive, index) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: Identical uploaded files keep their source order throughout this preview.
              <div key={`${dive.key}-${index}`} className="space-y-4 border-t border-border pt-4">
                <ChoiceRow
                  type="checkbox"
                  checked={selected.has(dive.key)}
                  disabled={pending || dive.duplicate === "exact"}
                  onChange={(event) => {
                    const next = new Set(selected);
                    if (event.target.checked) next.add(dive.key);
                    else next.delete(dive.key);
                    setSelected(next);
                    change();
                  }}
                >
                  {copy.selected}: {dive.record.localStart} · {dive.record.device ?? copy.unknown}
                </ChoiceRow>
                {dive.duplicate ? (
                  <p className="text-sm text-warning-strong">
                    {dive.duplicate === "exact" ? copy.exact : copy.possible}
                  </p>
                ) : null}
                <PreviewFacts record={dive.record} copy={copy} />
                <details>
                  <summary className="min-h-11 cursor-pointer py-2 font-medium">
                    {copy.details}
                  </summary>
                  <div className="py-4">
                    <RecordDetails record={dive.record} copy={copy} />
                  </div>
                </details>
                {selected.has(dive.key) ? (
                  <div className="space-y-3">
                    <p className="text-sm text-muted">{copy.keepZone}</p>
                    {dive.record.offsetMinutes === null ? (
                      <Field
                        label={copy.offset}
                        htmlFor={`offset-${index}`}
                        description={copy.offsetHint}
                      >
                        <input
                          id={`offset-${index}`}
                          type="number"
                          min={-840}
                          max={840}
                          step={1}
                          className={controlClass}
                          value={offsets[dive.key] ?? ""}
                          disabled={pending}
                          onChange={(event) => {
                            setOffsets({ ...offsets, [dive.key]: event.target.value });
                            setReviewed(new Set([...reviewed].filter((key) => key !== dive.key)));
                            change();
                          }}
                        />
                      </Field>
                    ) : null}
                    <ChoiceRow
                      type="checkbox"
                      checked={reviewed.has(dive.key)}
                      disabled={pending}
                      onChange={(event) => {
                        const next = new Set(reviewed);
                        if (event.target.checked) next.add(dive.key);
                        else next.delete(dive.key);
                        setReviewed(next);
                        change();
                      }}
                    >
                      {copy.confirmZone}
                    </ChoiceRow>
                  </div>
                ) : null}
              </div>
            ))}
            <ChoiceRow
              type="checkbox"
              checked={confirmed}
              disabled={pending}
              onChange={(event) => {
                setConfirmed(event.target.checked);
                change();
              }}
            >
              {copy.confirmTarget} <strong>{personName}</strong>
            </ChoiceRow>
            <div className="flex flex-wrap gap-3">
              <button
                type="submit"
                disabled={pending || !ready}
                className={buttonClass({ variant: "secondary" })}
              >
                {pending ? copy.busy : result ? copy.retry : copy.commit}
              </button>
              <button
                type="button"
                onClick={reset}
                disabled={pending}
                className={buttonClass({ variant: "secondary" })}
              >
                {copy.cancel}
              </button>
            </div>
            {result ? (
              <div role="status" className="space-y-2">
                <p className="font-medium">{copy.done}</p>
                <dl className="flex flex-wrap gap-6">
                  <Fact label={copy.imported} value={result.imported} unknown={copy.unknown} />
                  <Fact label={copy.skipped} value={result.skipped} unknown={copy.unknown} />
                  <Fact
                    label={copy.fileErrors}
                    value={preview.files.filter((file) => file.error !== null).length}
                    unknown={copy.unknown}
                  />
                </dl>
              </div>
            ) : null}
          </form>
        </section>
      ) : null}
      <HistoryLedger
        canExport={canExport}
        history={history}
        copy={copy}
        pending={pending}
        download={download}
        mutate={mutate}
      />
    </div>
  );
}
