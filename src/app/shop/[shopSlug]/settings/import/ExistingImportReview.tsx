// biome-ignore-all lint/suspicious/noArrayIndexKey: Immutable CSV positions identify repeated headers and rows; this grid cannot reorder.
"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { buttonClass } from "@/components/ui/button";
import { ChoiceFieldset, controlClass, Field, FormStatus } from "@/components/ui/form";
import { Table, TBody, Td, THead, Th, Tr } from "@/components/ui/table";
import { MAX_IMPORT_BYTES, parseCsv } from "@/lib/import";
import { importCorrectionCsv, mapImportColumns } from "@/lib/import-column-mapping";
import { normalizeImportKey } from "@/lib/import-key";
import { type FileImportReview, reviewExistingImportAction } from "./review-actions";

export type ExistingImportCopy = {
  choose: string;
  chooseAnother: string;
  mapping: string;
  unmapped: string;
  review: string;
  submit: string;
  busy: string;
  safety: string;
  preview: string;
  row: string;
  outcome: string;
  correction: string;
  correctionFilename: string;
  failed: string;
  stale: string;
  result: string;
  fileType: string;
  sites: string;
  creatures: string;
  outcomes: Record<"create" | "update" | "duplicate" | "skip" | "processed", string>;
  counts: Record<string, string>;
  errors: Record<string, string>;
  mappingRequired: string;
};
type Picked = { file: File; grid: string[][]; mapping: string[]; type: string };

/** Files remain local until review. Each response belongs to one file/mapping generation. */
export function ExistingImportReview({
  kind,
  columns,
  aliases = {},
  copy,
}: {
  kind: "gear" | "sites";
  columns: Record<string, readonly string[]>;
  aliases?: Record<string, string>;
  copy: ExistingImportCopy;
}) {
  const [picked, setPicked] = useState<Picked[]>([]);
  const [result, setResult] = useState<FileImportReview | null>(null);
  const [pending, startTransition] = useTransition();
  const [reading, setReading] = useState(false);
  const generation = useRef(0);
  const mounted = useRef(true);
  const pathname = usePathname();
  useEffect(() => {
    if (pathname) {
      setPicked([]);
      setResult(null);
      setReading(false);
    }
    mounted.current = true;
    return () => {
      mounted.current = false;
      generation.current++;
    };
  }, [pathname]);
  function invalidate() {
    generation.current++;
    setResult(null);
  }
  async function selectFiles(files: File[]) {
    invalidate();
    const current = generation.current;
    setPicked([]);
    setReading(true);
    try {
      if (
        files.length > (kind === "gear" ? 1 : 2) ||
        files.some((file) => file.size > MAX_IMPORT_BYTES)
      )
        throw new Error();
      const next = await Promise.all(
        files.map(async (file) => {
          const csv = await file.text();
          const grid = parseCsv(csv).filter((row) => row.some((cell) => cell.trim()));
          const type =
            kind === "gear"
              ? "gear"
              : grid[0]?.some((header) => normalizeImportKey(header) === "catalog_slug")
                ? "creatures"
                : "sites";
          const mapping = (grid[0] ?? []).map(
            (header) =>
              aliases[normalizeImportKey(header)] ??
              (columns[type].includes(normalizeImportKey(header))
                ? normalizeImportKey(header)
                : ""),
          );
          const checked = mapImportColumns(csv, mapping, columns[type]);
          if ("error" in checked && checked.error !== "invalid_mapping")
            throw new Error(checked.error);
          return { file, grid, mapping, type };
        }),
      );
      if (mounted.current && current === generation.current) setPicked(next);
    } catch (error) {
      if (mounted.current && current === generation.current)
        setResult({ error: error instanceof Error ? error.message : "file_read_failed" });
    } finally {
      if (mounted.current && current === generation.current) setReading(false);
    }
  }
  function change(index: number, update: Partial<Picked>) {
    invalidate();
    setPicked((old) => old.map((file, at) => (at === index ? { ...file, ...update } : file)));
  }
  function run(commit: boolean) {
    const current = generation.current;
    const form = new FormData();
    form.set("kind", kind);
    form.set("mappings", JSON.stringify(picked.map((file) => file.mapping)));
    form.set("types", JSON.stringify(picked.map((file) => file.type)));
    for (const file of picked) form.append("file", file.file);
    startTransition(async () => {
      let response: FileImportReview;
      try {
        response = await reviewExistingImportAction(form, commit);
      } catch {
        response = { error: "request_failed" };
      }
      if (mounted.current && current === generation.current) setResult(response);
    });
  }
  const valid =
    picked.length > 0 &&
    picked.every(
      (file) =>
        !(
          "error" in
          mapImportColumns(
            file.grid
              .map((row) => row.map((cell) => `"${cell.replaceAll('"', '""')}"`).join(","))
              .join("\r\n"),
            file.mapping,
            columns[file.type],
          )
        ),
    );
  return (
    <div className="mt-5 space-y-5">
      <p className="text-sm text-muted">{copy.safety}</p>
      <label
        className={buttonClass({
          variant: "secondary",
          className: "cursor-pointer has-[:focus-visible]:focus-ring",
        })}
      >
        {picked.length ? copy.chooseAnother : copy.choose}
        <input
          type="file"
          accept=".csv,text/csv"
          multiple={kind === "sites"}
          className="sr-only"
          onChange={(event) => {
            void selectFiles([...(event.target.files ?? [])]);
          }}
        />
      </label>
      {picked.length && !valid ? (
        <p className="text-sm text-muted">{copy.mappingRequired}</p>
      ) : null}
      {reading ? <p className="text-sm text-muted">{copy.busy}</p> : null}
      {picked.map((file, index) => (
        <section key={`${index}-${file.file.name}`} className="min-w-0 space-y-4">
          <h3 className="break-words font-medium">{file.file.name}</h3>
          {kind === "sites" ? (
            <Field label={copy.fileType}>
              <select
                className={controlClass}
                value={file.type}
                onChange={(event) => {
                  const type = event.target.value;
                  change(index, {
                    type,
                    mapping: (file.grid[0] ?? []).map((header) =>
                      columns[type].includes(normalizeImportKey(header))
                        ? normalizeImportKey(header)
                        : "",
                    ),
                  });
                }}
              >
                <option value="sites">{copy.sites}</option>
                <option value="creatures">{copy.creatures}</option>
              </select>
            </Field>
          ) : null}
          <ChoiceFieldset legend={copy.mapping} className="grid gap-3 sm:grid-cols-2">
            {(file.grid[0] ?? []).map((header, column) => (
              <Field key={`${column}-${header}`} label={`${column + 1}. ${header}`}>
                <select
                  className={controlClass}
                  value={file.mapping[column] ?? ""}
                  onChange={(event) => {
                    const mapping = [...file.mapping];
                    mapping[column] = event.target.value;
                    change(index, { mapping });
                  }}
                >
                  <option value="">{copy.unmapped}</option>
                  {columns[file.type].map((field) => (
                    <option key={field} value={field}>
                      {field}
                    </option>
                  ))}
                </select>
              </Field>
            ))}
          </ChoiceFieldset>
          <p className="text-sm text-muted">
            {copy.preview} · {Math.min(60, Math.max(0, file.grid.length - 1))} /{" "}
            {Math.max(0, file.grid.length - 1)}
          </p>
          {result?.rows?.[index] ? (
            <ul className="flex flex-wrap gap-x-5 gap-y-2 text-sm text-muted">
              {Object.entries(copy.outcomes).map(([outcome, label]) => {
                const count =
                  result.rows?.[index]?.filter((row) => row.outcome === outcome).length ?? 0;
                return count ? (
                  <li key={outcome}>
                    {label}: {count}
                  </li>
                ) : null;
              })}
            </ul>
          ) : null}
          <section
            // biome-ignore lint/a11y/noNoninteractiveTabindex: Keyboard scrolling for a wide CSV table.
            tabIndex={0}
            aria-label={`${copy.preview}: ${file.file.name}`}
            className="overflow-x-auto focus-visible:focus-ring"
          >
            <Table minWidth="40rem">
              <THead>
                <Th>{copy.row}</Th>
                <Th>{copy.outcome}</Th>
                {(file.grid[0] ?? []).map((header, at) => (
                  <Th key={`${at}-${header}`}>{header}</Th>
                ))}
              </THead>
              <TBody>
                {file.grid.slice(1, 61).map((row, at) => {
                  const outcome = result?.rows?.[index]?.find(
                    (entry) => entry.rowNumber === at + 2,
                  );
                  return (
                    <Tr key={at + 2}>
                      <Td>{at + 2}</Td>
                      <Td>
                        {outcome ? copy.outcomes[outcome.outcome] : copy.stale}
                        {outcome?.issues.length ? (
                          <p className="break-words text-xs text-muted">
                            {outcome.issues.join(", ")}
                          </p>
                        ) : null}
                      </Td>
                      {(file.grid[0] ?? []).map((_, column) => (
                        <Td key={column}>
                          <span className="break-words">{row[column] ?? ""}</span>
                        </Td>
                      ))}
                    </Tr>
                  );
                })}
              </TBody>
            </Table>
          </section>
          {result?.rows?.[index]?.some(needsAttention) ? (
            <a
              className={buttonClass({ variant: "secondary" })}
              download={copy.correctionFilename}
              href={`data:text/csv;charset=utf-8,${encodeURIComponent(
                importCorrectionCsv(file.grid, result.rows[index].filter(needsAttention)),
              )}`}
            >
              {copy.correction}
            </a>
          ) : null}
        </section>
      ))}
      {result?.error ? <FormStatus>{copy.errors[result.error] ?? copy.failed}</FormStatus> : null}
      {result?.completed ? (
        <div className="space-y-2">
          <p className="font-medium">{copy.result}</p>
          <dl className="grid gap-2 sm:grid-cols-2">
            {Object.entries(result.counts ?? {}).map(([key, value]) => (
              <div key={key} className="flex justify-between gap-3">
                <dt>{copy.counts[key] ?? key}</dt>
                <dd className="tabular-nums">{value}</dd>
              </div>
            ))}
          </dl>
        </div>
      ) : (
        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            className={buttonClass({ variant: "secondary" })}
            disabled={!valid || pending || reading}
            onClick={() => run(false)}
          >
            {pending ? copy.busy : copy.review}
          </button>
          {result?.rows && !result.error ? (
            <button
              type="button"
              className={buttonClass({})}
              disabled={pending || !valid}
              onClick={() => run(true)}
            >
              {pending
                ? copy.busy
                : `${copy.submit} (${result.rows?.reduce((sum, rows) => sum + rows.filter((row) => row.outcome !== "skip" && (kind === "gear" || row.outcome !== "duplicate")).length, 0) ?? 0})`}
            </button>
          ) : null}
        </div>
      )}
    </div>
  );
}

function needsAttention(row: { issues: string[] }) {
  return row.issues.length > 0;
}
