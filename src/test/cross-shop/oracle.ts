/**
 * **The cross-shop oracle: does a value hold anything of shop A's?**
 *
 * Shop A's rows are known by their primary keys and by the `LEAK-A-<n>`
 * markers the fixture writes into its free text. A returned value leaks when
 * any string inside it, at any depth, is one of those keys or carries a
 * marker. The ids the caller passed in are excused: echoing back the id you
 * were given tells you nothing you did not know.
 */

export const LEAK_MARKER = "LEAK-A-";

export type Evidence = { path: string; value: string };

export type ShopAFingerprint = {
  /** Every primary key of a row that belongs to shop A, shop A's own id included. */
  ids: ReadonlySet<string>;
};

/** Up to `limit` places in `value` that hold shop A's data. */
export function findShopAValues(
  value: unknown,
  fingerprint: ShopAFingerprint,
  excused: ReadonlySet<string> = new Set(),
  limit = 3,
): Evidence[] {
  const found: Evidence[] = [];
  const seen = new Set<object>();
  const visit = (node: unknown, at: string) => {
    if (found.length >= limit) return;
    if (typeof node === "string") {
      if (excused.has(node)) return;
      if (fingerprint.ids.has(node) || node.includes(LEAK_MARKER)) {
        found.push({ path: at || "(the value)", value: node.slice(0, 120) });
      }
      return;
    }
    if (typeof node !== "object" || node === null) return;
    if (seen.has(node)) return;
    seen.add(node);
    if (node instanceof Date) return;
    if (node instanceof Map) {
      for (const [key, entry] of node) {
        visit(key, `${at}<key>`);
        visit(entry, `${at}[${String(key)}]`);
      }
      return;
    }
    if (node instanceof Set || Array.isArray(node)) {
      let i = 0;
      for (const entry of node) visit(entry, `${at}[${i++}]`);
      return;
    }
    for (const [key, entry] of Object.entries(node)) visit(entry, at ? `${at}.${key}` : key);
  };
  visit(value, "");
  return found;
}

/** Every string inside the call's arguments, the ids it was handed among them. */
export function stringsIn(value: unknown): Set<string> {
  const strings = new Set<string>();
  const visit = (node: unknown) => {
    if (typeof node === "string") strings.add(node);
    else if (Array.isArray(node)) node.forEach(visit);
    else if (typeof node === "object" && node !== null && !(node instanceof Date)) {
      Object.values(node).forEach(visit);
    }
  };
  visit(value);
  return strings;
}
