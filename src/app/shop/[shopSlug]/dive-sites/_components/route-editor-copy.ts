import type { StaffTranslator } from "@/i18n/staff-messages";
import { MAX_ROUTE_POINTS } from "@/lib/dive-site-route";
import type { RouteEditorCopy } from "./RouteEditor";

/**
 * Resolve the editor's words, including one status sentence per waypoint
 * count.
 *
 * The status array is built here rather than in the component because the
 * count is client state and staff copy is server-only: a component that
 * interpolated `{count}` itself would be doing pluralisation in the one place
 * it cannot be translated (AGENTS.md). `MAX_ROUTE_POINTS + 1` entries covers
 * every count the editor can reach.
 */
export function routeEditorCopy(t: StaffTranslator): RouteEditorCopy {
  return {
    legend: t("diveSites.form.route.legend"),
    description: t("diveSites.form.route.description"),
    needsCoordinates: t("diveSites.form.route.needsCoordinates"),
    labelLabel: t("diveSites.form.route.labelLabel"),
    labelPlaceholder: t("diveSites.form.route.labelPlaceholder"),
    noteLabel: t("diveSites.form.route.noteLabel"),
    notePlaceholder: t("diveSites.form.route.notePlaceholder"),
    zoomLabel: t("diveSites.form.route.zoomLabel"),
    zoomIn: t("diveSites.form.route.zoomIn"),
    zoomOut: t("diveSites.form.route.zoomOut"),
    undo: t("diveSites.form.route.undo"),
    clear: t("diveSites.form.route.clear"),
    mapAriaLabel: t("diveSites.form.route.mapAriaLabel"),
    status: Array.from({ length: MAX_ROUTE_POINTS + 1 }, (_unused, count) =>
      count === MAX_ROUTE_POINTS
        ? t("diveSites.form.route.status.full", { count })
        : count === 0
          ? t("diveSites.form.route.status.empty")
          : count === 1
            ? t("diveSites.form.route.status.one")
            : t("diveSites.form.route.status.some", { count }),
    ),
  };
}
