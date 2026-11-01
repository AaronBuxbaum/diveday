"use client";

import { useEffect, useRef, useState } from "react";
import { EmptyState } from "@/components/EmptyState";
import { MapEmbed } from "@/components/MapEmbed";
import { RouteWaypoint } from "@/components/RouteWaypoint";
import { buttonClass } from "@/components/ui/button";
import { controlClass, Field, FieldGrid } from "@/components/ui/form";
import {
  DEFAULT_ROUTE_ZOOM,
  hasRoute,
  MAX_ROUTE_POINTS,
  MAX_ROUTE_ZOOM,
  MIN_ROUTE_ZOOM,
  type RoutePoint,
  routePathD,
} from "@/lib/dive-site-route";

export type RouteEditorCopy = {
  /** Shown instead of the map when the site has no coordinates yet. */
  needsCoordinates: string;
  labelLabel: string;
  labelPlaceholder: string;
  noteLabel: string;
  notePlaceholder: string;
  zoomLabel: string;
  zoomIn: string;
  zoomOut: string;
  undo: string;
  clear: string;
  /**
   * Live status, one resolved sentence per waypoint count (index 0 through
   * `MAX_ROUTE_POINTS`). An array rather than a template with `{count}` in it
   * because the count is client state and staff copy is resolved server-side —
   * interpolating here would put pluralisation in a component, which is the one
   * place it cannot be translated (AGENTS.md).
   */
  status: string[];
  mapAriaLabel: string;
};

/**
 * Draw a route on the site's terrain view. Waypoints are percentages of a
 * persisted frame (`src/lib/dive-site-route.ts`): only the site coordinates
 * and saved zoom move it, so the briefing reproduces the same geometry.
 * Drawing uses a named pointer surface; route points remain in a hidden input,
 * and label, note, and zoom remain ordinary controls.
 */
export function RouteEditor({
  initialPoints,
  initialLabel,
  initialNote,
  initialZoom,
  latitude,
  longitude,
  copy,
}: {
  initialPoints: RoutePoint[];
  initialLabel: string;
  initialNote: string;
  initialZoom: number;
  /** The site's stored coordinates; null on a brand-new site with none typed yet. */
  latitude: number | null;
  longitude: number | null;
  copy: RouteEditorCopy;
}) {
  const [points, setPoints] = useState<RoutePoint[]>(initialPoints);
  const [zoom, setZoom] = useState(initialZoom || DEFAULT_ROUTE_ZOOM);
  const [coordinates, setCoordinates] = useState<{ lat: number; lng: number } | null>(
    typeof latitude === "number" && typeof longitude === "number"
      ? { lat: latitude, lng: longitude }
      : null,
  );
  const rootRef = useRef<HTMLDivElement>(null);

  // Read the sibling uncontrolled coordinate fields so new sites can draw
  // before saving; SiteFormShell restores them after a refused submit.
  useEffect(() => {
    const form = rootRef.current?.closest("form");
    if (!form) return;
    const latField = form.elements.namedItem("forecastLatitude");
    const lngField = form.elements.namedItem("forecastLongitude");
    if (!(latField instanceof HTMLInputElement) || !(lngField instanceof HTMLInputElement)) return;
    const read = () => {
      const lat = Number.parseFloat(latField.value);
      const lng = Number.parseFloat(lngField.value);
      setCoordinates(
        Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180
          ? { lat, lng }
          : null,
      );
    };
    read();
    latField.addEventListener("input", read);
    lngField.addEventListener("input", read);
    return () => {
      latField.removeEventListener("input", read);
      lngField.removeEventListener("input", read);
    };
  }, []);

  const full = points.length >= MAX_ROUTE_POINTS;

  function addPoint(event: React.MouseEvent<HTMLButtonElement>) {
    if (full) return;
    const box = event.currentTarget.getBoundingClientRect();
    if (box.width === 0 || box.height === 0) return;
    const x = ((event.clientX - box.left) / box.width) * 100;
    const y = ((event.clientY - box.top) / box.height) * 100;
    setPoints((current) => [
      ...current,
      { x: Math.round(x * 100) / 100, y: Math.round(y * 100) / 100 },
    ]);
  }

  const status = copy.status[points.length] ?? copy.status[copy.status.length - 1];

  return (
    // The form's route section supplies the legend (ADR 20260827-the-shops-shelves).
    <div ref={rootRef}>
      {/* The record the form posts. Always present, even with no coordinates:
          clearing a route has to be savable too. */}
      <input type="hidden" name="routePoints" value={JSON.stringify(points)} />
      <input type="hidden" name="routeZoom" value={zoom} />

      {coordinates ? (
        <>
          <div className="overflow-hidden rounded-lg border border-border">
            {/* A panned map would break the persisted percentage frame. */}
            <MapEmbed
              title={copy.mapAriaLabel}
              latitude={coordinates.lat}
              longitude={coordinates.lng}
              zoom={zoom}
              className="h-[calc(18rem+4rem)]"
            >
              {/* A named button supports keyboard focus and taps without dragging. */}
              <button
                type="button"
                aria-label={copy.mapAriaLabel}
                onClick={addPoint}
                className="absolute inset-0 h-full w-full cursor-crosshair rounded-t-lg focus-visible:focus-ring-inset"
              />
              <svg
                viewBox="0 0 100 100"
                className="pointer-events-none absolute inset-0 h-full w-full"
                aria-hidden="true"
                preserveAspectRatio="none"
              >
                {hasRoute(points) ? (
                  <path
                    d={routePathD(points)}
                    fill="none"
                    stroke="var(--accent)"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2.25"
                    vectorEffect="non-scaling-stroke"
                  />
                ) : null}
              </svg>
              {/* Separate dots stay circular over the stretched route frame (K-413). */}
              {points.map((point, index) => (
                <RouteWaypoint
                  // Duplicate points are allowed; index is their only identity.
                  // biome-ignore lint/suspicious/noArrayIndexKey: points have no unique id
                  key={index}
                  point={point}
                  className={`border-surface ${
                    index === 0
                      ? "bg-primary"
                      : index === points.length - 1
                        ? "bg-accent"
                        : "bg-surface"
                  }`}
                />
              ))}
            </MapEmbed>
          </div>

          {/* Keep each control pair together and align wrapped rows (K-268). */}
          <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
            <p className="mr-auto text-sm text-muted" aria-live="polite">
              {status}
            </p>
            <span className="flex items-center gap-2">
              <span className="text-sm font-medium text-muted">{copy.zoomLabel}</span>
              <button
                type="button"
                onClick={() => setZoom((z) => Math.max(MIN_ROUTE_ZOOM, z - 1))}
                disabled={zoom <= MIN_ROUTE_ZOOM}
                className={buttonClass({ variant: "secondary", size: "sm" })}
              >
                {copy.zoomOut}
              </button>
              <button
                type="button"
                onClick={() => setZoom((z) => Math.min(MAX_ROUTE_ZOOM, z + 1))}
                disabled={zoom >= MAX_ROUTE_ZOOM}
                className={buttonClass({ variant: "secondary", size: "sm" })}
              >
                {copy.zoomIn}
              </button>
            </span>
            <span className="flex items-center gap-5">
              <button
                type="button"
                onClick={() => setPoints((current) => current.slice(0, -1))}
                disabled={points.length === 0}
                className={buttonClass({ variant: "secondary", size: "sm" })}
              >
                {copy.undo}
              </button>
              <button
                type="button"
                onClick={() => setPoints([])}
                disabled={points.length === 0}
                className={buttonClass({ variant: "ghost", size: "sm", flush: true })}
              >
                {copy.clear}
              </button>
            </span>
          </div>
        </>
      ) : (
        // Nested in a section, so use the compact shared empty state.
        <EmptyState title={copy.needsCoordinates} icon={false} />
      )}

      <FieldGrid columns={2} className="mt-4">
        <Field label={copy.labelLabel}>
          <input
            name="routeLabel"
            maxLength={80}
            defaultValue={initialLabel}
            placeholder={copy.labelPlaceholder}
            className={controlClass}
          />
        </Field>
        <Field label={copy.noteLabel}>
          <input
            name="routeNote"
            maxLength={240}
            defaultValue={initialNote}
            placeholder={copy.notePlaceholder}
            className={controlClass}
          />
        </Field>
      </FieldGrid>
    </div>
  );
}
