import type { DiverLocale } from "./settings";

/** Everything one map's rows need to say, with the map's own code type erased. */
export type LabelMapCase = {
  /** The file it lives in, spelled as the scan at the bottom names it. */
  module: string;
  /** The map's identifier, likewise. */
  map: string;
  rows: readonly LabelRow[];
};

export type LabelRow = {
  code: string;
  /** True for a code whose label is deliberately nothing at all. */
  silent: boolean;
  /** The finished string a surface renders for this code, in one locale. */
  render: (locale: DiverLocale) => string | null;
};

/**
 * One row per code, closing over the code so the table can hold maps keyed by
 * different unions without a cast.
 */
export function codeRows<Code extends string>(
  codes: readonly Code[],
  render: (locale: DiverLocale, code: Code) => string | null,
  silent: readonly Code[] = [],
): readonly LabelRow[] {
  return codes.map((code) => ({
    code,
    silent: silent.includes(code),
    render: (locale: DiverLocale) => render(locale, code),
  }));
}

/**
 * The codes of a union with no runtime list of its own. Spelled as a
 * `Record<Code, true>` rather than an array so a member added to the union is a
 * type error here, not a row that silently goes unproven.
 */
export function everyCodeOf<Code extends string>(present: Record<Code, true>): readonly Code[] {
  return Object.keys(present) as Code[];
}
