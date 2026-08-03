/**
 * Shape of the new-order form, shared by the page that draws it and the action
 * that reads it back. Kept out of the `"use server"` action file (a
 * `"use server"` module may only export async functions) — same split as
 * `src/app/actions/invoice-resend-types.ts`.
 */

/** Blank line-item rows the form offers, and the rows the action reads. */
export const LINE_ITEM_ROWS = 4;
