/** A user-chosen logbook origin, never proof that the vendor produced an uploaded file. */
const COMPUTER_LOGBOOK_PROVIDERS = [
  "generic",
  "oceanic",
  "padi",
  "ssi",
  "garmin",
  "shearwater",
  "subsurface",
  "suunto",
] as const;

export type ComputerLogbookProvider = (typeof COMPUTER_LOGBOOK_PROVIDERS)[number];
export type ComputerImportOrigin = { provider: ComputerLogbookProvider; beta: true };

export function isComputerLogbookProvider(value: unknown): value is ComputerLogbookProvider {
  return (
    typeof value === "string" && COMPUTER_LOGBOOK_PROVIDERS.some((provider) => provider === value)
  );
}
