/**
 * **"Add one" is one grammar** (issue #2737): a thing is added on its own
 * index, in a panel the URL opens with `?add=`, and the form lands back on
 * that same URL with `?notice=`. There is no `/new` segment under `/shop`.
 *
 * This module is the framework-free half: how a page reads the panel's open
 * state off its URL, and how it spells the links that open and close it.
 * `src/components/AddPanel.tsx` draws the panel.
 */

/** The one query key every add panel answers to. */
export const ADD_PARAM = "add";

/** The value an index with a single add panel opens it with. */
export const ADD_ONE = "1";

type Search = Record<string, string | string[] | undefined>;

/** Whether `?add=` names this panel (`1` unless the index has several). */
export function addPanelOpen(value: string | string[] | undefined, panel: string = ADD_ONE) {
  return value === panel;
}

/**
 * An index's link that opens its add panel, carrying any context the form
 * prefills from (`personId`, `unitId`, a seat flow's `tripId`). Empty values
 * are left off, so a caller can pass optional context as it stands.
 */
export function addPanelHref(
  path: string,
  panel: string = ADD_ONE,
  context: Record<string, string | null | undefined> = {},
): string {
  const query = new URLSearchParams({ [ADD_PARAM]: panel });
  for (const [key, value] of Object.entries(context)) {
    if (value) query.set(key, value);
  }
  return `${path}?${query}`;
}

/**
 * The same index with its panel shut: `add` and every key the panel's own form
 * reads (`formKeys`) go, the index's own reading (search, filter, page) stays.
 * `notice` always goes with the panel, because the panel is what said it.
 */
export function addPanelCloseHref(
  path: string,
  search: Search,
  formKeys: readonly string[] = [],
): string {
  const drop = new Set([ADD_PARAM, "notice", ...formKeys]);
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(search)) {
    if (drop.has(key) || typeof value !== "string" || value === "") continue;
    query.set(key, value);
  }
  return query.size > 0 ? `${path}?${query}` : path;
}
