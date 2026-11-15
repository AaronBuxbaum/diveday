/** Parsed evidence only: no field is an operational safety input. */
export type ComputerSourceFormat = "uddf" | "subsurface" | "csv";
export type ComputerSample = { seconds: number; depthMeters: number; temperatureC?: number };
export type ComputerGas = {
  id: string;
  oxygenFraction: number | null;
  heliumFraction: number | null;
};
export type ComputerTank = {
  gasId: string | null;
  volumeLiters: number | null;
  startPressureBar: number | null;
  endPressureBar: number | null;
};
export type ParsedComputerDive = {
  sourceFormat: ComputerSourceFormat;
  sourceId: string | null;
  device: string | null;
  deviceId?: string | null;
  recordingIndex?: number;
  localStart: string;
  startInstant: string | null;
  offsetMinutes: number | null;
  durationSeconds: number | null;
  maxDepthMeters: number | null;
  samples: ComputerSample[];
  gases: ComputerGas[];
  tanks: ComputerTank[];
  warnings: string[];
  sourceUnits: {
    depth: "m" | "ft";
    temperature: "K" | "C" | "F" | null;
    pressure: "Pa" | "bar" | "psi" | null;
  };
};
export const COMPUTER_IMPORT_LIMITS = {
  fileBytes: 5 * 1024 * 1024,
  dives: 500,
  samplesPerDive: 10_000,
  samplesPerFile: 100_000,
  xmlDepth: 32,
  xmlNodes: 250_000,
  textLength: 4096,
} as const;
export type ComputerImportErrorCode =
  | "file_too_large"
  | "invalid_encoding"
  | "unsupported_format"
  | "unsupported_fit"
  | "unsafe_xml"
  | "invalid_xml"
  | "limit_exceeded"
  | "invalid_value"
  | "unknown_units"
  | "invalid_reference"
  | "no_dives"
  | "invalid_csv";
export class ComputerImportError extends Error {
  constructor(public readonly code: ComputerImportErrorCode) {
    super(code);
    this.name = "ComputerImportError";
  }
}
export function refuse(code: ComputerImportErrorCode): never {
  throw new ComputerImportError(code);
}
export function finite(raw: string | undefined | null, min = 0, max = 1_000_000): number | null {
  if (raw === undefined || raw === null || raw.trim() === "") return null;
  if (!/^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(raw.trim())) refuse("invalid_value");
  const n = Number(raw);
  if (!Number.isFinite(n) || n < min || n > max) refuse("invalid_value");
  return n;
}
