/**
 * The keys `KeepTypedOnRefusal` stores under, outside its `"use client"`
 * module so a server page can compute its scope: a server component cannot
 * call a function exported from a client module.
 */
export const KEPT_PREFIX = "diveday.refused-form.";

/**
 * Where a form's last submission waits, per tab, until the answer comes back:
 * one key per form and per `scope` (the shop's slug and the staffer's person
 * id), so the next staffer on a shared tab never sees the last one's typing.
 */
export function keptTypedKey(form: string, scope: string): string {
  return `${KEPT_PREFIX}${scope}.${form}`;
}

/** The scope a staff page passes: this shop, this staffer. */
export function keptTypedScope(shopSlug: string, personId: string): string {
  return `${shopSlug}.${personId}`;
}
