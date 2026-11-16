import { useEffect, useState } from "react";
import { buttonClass } from "@/components/ui/button";
import { ChoiceRow, controlClass, Field } from "@/components/ui/form";
import type { StaffMessages } from "@/i18n/staff-messages";
import { inspectComputerCsvColumns } from "@/lib/computer-csv-columns";
import type { ComputerCsvMapping, ComputerLogbookProvider } from "@/lib/computer-import";

type Copy = StaffMessages["computerDives"];
const guides: Partial<Record<ComputerLogbookProvider, string>> = {
  oceanic: "https://www.oceanicworldwide.com/faqs/",
  padi: "https://www.padi.com/scuba-diving-mobile-apps",
  ssi: "https://www.divessi.com/en/blog/blog/blog/scubapro-logtrak-myssi-app-integration-10251.html",
  garmin: "https://support.garmin.com/en-US/?faq=NxZWyZYGqL17VNBMKDUjb5",
  shearwater: "https://shearwater.com/pages/shearwater-cloud",
  subsurface: "https://subsurface-divelog.org/subsurface-user-manual/",
  suunto:
    "https://www.suunto.com/Support/faq-articles/suunto-app/what-type-of-files-can-i-export-from-the-suunto-app/",
};
const fields = ["date", "time", "duration", "maxDepth", "utcOffset", "device", "sourceId"] as const;
type Columns = Partial<Record<(typeof fields)[number], string>>;

/** Read bounded local bytes only; the server independently validates the selected mapping. */
function fileBytes(file: File): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () =>
      reader.result instanceof ArrayBuffer
        ? resolve(new Uint8Array(reader.result))
        : reject(new Error());
    reader.readAsArrayBuffer(file);
  });
}

export function useImportSource(files: File[]) {
  const [provider, setProvider] = useState<ComputerLogbookProvider>("generic");
  const [mappingEnabled, setMappingEnabled] = useState(false);
  const [columns, setColumns] = useState<Columns>({});
  const [headers, setHeaders] = useState<string[]>([]);
  const [dateFormat, setDateFormat] = useState<ComputerCsvMapping["dateFormat"] | "">("");
  const [durationUnit, setDurationUnit] = useState<ComputerCsvMapping["durationUnit"] | "">("");
  const [depthUnit, setDepthUnit] = useState<ComputerCsvMapping["depthUnit"] | "">("");
  const [reading, setReading] = useState(false);
  const [headerError, setHeaderError] = useState(false);
  useEffect(() => {
    let active = true;
    setColumns({});
    setHeaders([]);
    setDateFormat("");
    setDurationUnit("");
    setDepthUnit("");
    setHeaderError(false);
    setReading(false);
    if (!mappingEnabled || !files.length) return;
    const file = files.find((entry) => /\.csv$/i.test(entry.name)) ?? files[0];
    if (file.size > 2 * 1024 * 1024) {
      setHeaderError(true);
      return;
    }
    setReading(true);
    void fileBytes(file)
      .then((bytes) => {
        const inspected = inspectComputerCsvColumns(bytes, 2 * 1024 * 1024);
        if (active) setHeaders(inspected);
      })
      .catch(() => {
        if (active) setHeaderError(true);
      })
      .finally(() => {
        if (active) setReading(false);
      });
    return () => {
      active = false;
    };
  }, [files, mappingEnabled]);
  const mapped = Object.values(columns).filter(Boolean);
  const valid =
    !mappingEnabled ||
    (!reading &&
      !headerError &&
      !!columns.date &&
      !!dateFormat &&
      (!columns.duration || !!durationUnit) &&
      (!columns.maxDepth || !!depthUnit) &&
      mapped.every((value) => headers.includes(value)) &&
      new Set(mapped).size === mapped.length);
  const csvMapping: ComputerCsvMapping | undefined =
    mappingEnabled && valid
      ? {
          columns: Object.fromEntries(
            Object.entries(columns).filter(([, value]) => value),
          ) as ComputerCsvMapping["columns"],
          dateFormat: dateFormat as ComputerCsvMapping["dateFormat"],
          // Inactive units carry no mapped data; selected fields require an explicit choice above.
          durationUnit: durationUnit || "seconds",
          depthUnit: depthUnit || "m",
        }
      : undefined;
  const resetSource = () => {
    setProvider("generic");
    setMappingEnabled(false);
    setColumns({});
    setDateFormat("");
    setDurationUnit("");
    setDepthUnit("");
  };
  return {
    provider,
    setProvider,
    mappingEnabled,
    setMappingEnabled,
    columns,
    setColumns,
    headers,
    dateFormat,
    setDateFormat,
    durationUnit,
    setDurationUnit,
    depthUnit,
    setDepthUnit,
    reading,
    headerError,
    valid,
    options: { provider, ...(csvMapping ? { csvMapping } : {}) },
    resetSource,
  };
}

type Setup = ReturnType<typeof useImportSource>;
export function LogbookSource({
  source,
  copy,
  disabled,
}: {
  source: Setup;
  copy: Copy;
  disabled: boolean;
}) {
  const guide = guides[source.provider];
  return (
    <div className="space-y-3">
      <Field label={copy.provider} htmlFor="computer-provider">
        <select
          id="computer-provider"
          value={source.provider}
          disabled={disabled}
          className={controlClass}
          onChange={(event) => source.setProvider(event.target.value as ComputerLogbookProvider)}
        >
          {(Object.keys(copy.providers) as ComputerLogbookProvider[]).map((provider) => (
            <option key={provider} value={provider}>
              {copy.providers[provider].label}
              {provider === "generic" ? "" : ` · ${copy.beta}`}
            </option>
          ))}
        </select>
      </Field>
      <p className="text-sm text-muted">{copy.providers[source.provider].hint}</p>
      {guide ? (
        <a
          href={guide}
          target="_blank"
          rel="noreferrer"
          className={buttonClass({ variant: "link", size: "sm", flush: true })}
        >
          {copy.providerGuide}
        </a>
      ) : null}
      <p className="text-sm text-muted">{copy.betaHint}</p>
    </div>
  );
}

export function CsvMapping({
  source,
  copy,
  disabled,
}: {
  source: Setup;
  copy: Copy;
  disabled: boolean;
}) {
  return (
    <div className="space-y-4">
      <ChoiceRow
        type="checkbox"
        checked={source.mappingEnabled}
        disabled={disabled}
        onChange={(event) => source.setMappingEnabled(event.target.checked)}
      >
        {copy.mapCsv}
      </ChoiceRow>
      {source.mappingEnabled ? (
        <div className="space-y-4">
          <p className="text-sm text-muted">{copy.mappingHint}</p>
          {source.reading ? <p role="status">{copy.mappingReading}</p> : null}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {fields.map((field) => (
              <Field
                key={field}
                label={copy.mapping[field]}
                htmlFor={`csv-${field}`}
                error={field === "date" && source.headerError ? copy.mappingError : undefined}
                description={
                  field === "date"
                    ? copy.mappingDateHint
                    : field === "utcOffset"
                      ? copy.mappingOffsetHint
                      : undefined
                }
              >
                <select
                  id={`csv-${field}`}
                  className={controlClass}
                  disabled={disabled || !source.headers.length}
                  required={field === "date"}
                  value={source.columns[field] ?? ""}
                  onChange={(event) =>
                    source.setColumns({ ...source.columns, [field]: event.target.value })
                  }
                >
                  <option value="">
                    {field === "date" ? copy.mappingChoose : copy.mappingNone}
                  </option>
                  {source.headers.map((header) => (
                    <option key={header} value={header}>
                      {header}
                    </option>
                  ))}
                </select>
              </Field>
            ))}
            <Field label={copy.mapping.dateFormat} htmlFor="csv-date-format">
              <select
                id="csv-date-format"
                className={controlClass}
                value={source.dateFormat}
                required
                disabled={disabled}
                onChange={(event) =>
                  source.setDateFormat(event.target.value as Setup["dateFormat"])
                }
              >
                <option value="">{copy.mapping.chooseFormat}</option>
                {(["iso", "dmy", "mdy"] as const).map((format) => (
                  <option key={format} value={format}>
                    {copy.mapping[format]}
                  </option>
                ))}
              </select>
            </Field>
            {source.columns.duration ? (
              <Field label={copy.mapping.durationUnit} htmlFor="csv-duration-unit">
                <select
                  id="csv-duration-unit"
                  className={controlClass}
                  value={source.durationUnit}
                  required
                  disabled={disabled}
                  onChange={(event) =>
                    source.setDurationUnit(event.target.value as Setup["durationUnit"])
                  }
                >
                  <option value="">{copy.mapping.chooseUnit}</option>
                  <option value="seconds">{copy.mapping.seconds}</option>
                  <option value="minutes">{copy.mapping.minutes}</option>
                </select>
              </Field>
            ) : null}
            {source.columns.maxDepth ? (
              <Field label={copy.mapping.depthUnit} htmlFor="csv-depth-unit">
                <select
                  id="csv-depth-unit"
                  className={controlClass}
                  value={source.depthUnit}
                  required
                  disabled={disabled}
                  onChange={(event) =>
                    source.setDepthUnit(event.target.value as Setup["depthUnit"])
                  }
                >
                  <option value="">{copy.mapping.chooseUnit}</option>
                  <option value="m">{copy.mapping.m}</option>
                  <option value="ft">{copy.mapping.ft}</option>
                </select>
              </Field>
            ) : null}
          </div>
          {!source.valid ? <p className="text-sm text-muted">{copy.mappingRequired}</p> : null}
        </div>
      ) : null}
    </div>
  );
}
