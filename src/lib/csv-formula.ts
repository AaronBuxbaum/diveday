/**
 * The spreadsheet formula guard shared by the CSV export (which adds it) and
 * every CSV import (which removes it). Framework- and server-free so the
 * browser preview can import it.
 */

/** The full-width signs an East Asian locale can read as their ASCII twins. */
const FULL_WIDTH_SIGNS: Record<string, string> = {
  "\uff1d": "=",
  "\uff20": "@",
  "\uff0b": "+",
  "\uff0d": "-",
};

/**
 * Would this diver-authored string execute as a formula in Excel/LibreOffice?
 * `=`, `@`, tab, and CR always count. A leading `+` or `-` counts only when
 * followed by anything beyond digits and phone punctuation: `+1 305 555 0100`
 * is an E.164 phone number a destination system must receive intact — the one
 * thing a purely numeric cell can do in a spreadsheet is display as a number,
 * never reach a DDE/command payload, which needs letters or pipes.
 *
 * The OWASP bypass set is read the same way: leading blanks and line breaks
 * are skipped (an import can trim them), and a full-width `＝ ＠ ＋ －` is read
 * as its ASCII sign. A line break *inside* a cell is left alone: RFC-4180
 * quoting keeps it in that cell, which does not start a formula.
 */
export function opensAsFormula(text: string): boolean {
  if (/^[=@\t\r]/.test(text)) return true;
  const lead = text.replace(/^\s+/, "");
  const sign = FULL_WIDTH_SIGNS[lead.charAt(0)] ?? lead.charAt(0);
  const head = sign + lead.slice(1);
  if (/^[=@]/.test(head)) return true;
  return /^[+-]/.test(head) && !/^[+-][\d\s()./-]*$/.test(head);
}

/**
 * Undo the export's formula guard: a leading "'" in front of text that would
 * open as a formula ({@link opensAsFormula}) is the spreadsheet's text marker,
 * not part of the value. Anything else keeps its apostrophe, so "'Tis" and
 * "'-5" read as typed.
 */
export function unguardFormula(value: string): string {
  return value.startsWith("'") && opensAsFormula(value.slice(1)) ? value.slice(1) : value;
}
