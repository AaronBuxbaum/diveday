/** The saved row, or a failure naming the refusal. */
import type { editDiver } from "./store";

export function saved(result: Awaited<ReturnType<typeof editDiver>>) {
  if (!result.ok) throw new Error(`editDiver refused: ${result.reason}`);
  return result.person;
}

export const DATE_INTEREST = { scope: "date", askedBy: "diver" } as const;
