"use client";

import { useEffect, useRef, useState } from "react";
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
import { googleSatelliteEmbedUrl } from "@/lib/maps";

export type RouteEditorCopy = {
  legend: string;
  description: string;
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
 * Draw the route a dive takes, by clicking it onto the site's satellite view.
 *
 * The one thing a shop could never do before: routes lived in a hand-authored
 * lookup table keyed by site name, so DiveDay's three demo sites had a line on
 * the map and nobody else could have one. This is the tool that replaced it.
 *
 * **The map does not move.** A waypoint is stored as a percentage of this
 * frame (see `src/lib/dive-site-route.ts`), so the frame has to be one the
 * briefing can reproduce exactly: the site's own coordinates at a zoom stored
 * alongside the points. Letting the embed be panned would silently break that
 * — the shop would draw over the reef and a diver would read a line over open
 * sand — so the iframe is `pointer-events-none` and the view is moved with the
 * two things that persist: the coordinate fields above, and the zoom here.
 * That is a real constraint, stated rather than hidden: this control is honest
 * about drawing on the picture the diver will see.
 *
 * **A pointer, deliberately.** Clicking waypoints onto a picture wants a mouse
 * or a finger on a big screen, and this is a configure-once surface a shop sets
 * up at a desk — so it takes clicks and taps and does not pretend to be
 * keyboard-drawable. What it does keep for everyone is the record: the points
 * ride in a hidden input, so the form posts and saves identically either way,
 * and every other route field (label, note, zoom) is an ordinary box.
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
  const fieldsetRef = useRef<HTMLFieldSetElement>(null);

  // The frame follows the coordinate boxes as they are typed, rather than only
  // after a save. Without this a brand-new site is a chicken-and-egg: no
  // coordinates means no map to draw on, and the only way to get coordinates
  // onto the row is to save a site with no route and come back. Reading the two
  // sibling inputs out of the shared `<form>` is the price of keeping them
  // uncontrolled server-rendered fields — which is what lets a refused submit
  // hand the whole briefing back exactly as it was typed (`SiteFormShell`).
  useEffect(() => {
    const form = fieldsetRef.current?.closest("form");
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

  const query = coordinates ? `${coordinates.lat},${coordinates.lng}` : null;
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
    <fieldset ref={fieldsetRef} className="rounded-lg border border-border p-4">
      <legend className="px-1 text-sm font-medium">{copy.legend}</legend>
      <p className="mt-1 text-sm text-muted">{copy.description}</p>

      {/* The record the form posts. Always present, even with no coordinates:
          clearing a route has to be savable too. */}
      <input type="hidden" name="routePoints" value={JSON.stringify(points)} />
      <input type="hidden" name="routeZoom" value={zoom} />

      {query ? (
        <>
          <div className="mt-4 overflow-hidden rounded-lg border border-border">
            <div className="relative h-72">
              <iframe
                title={copy.mapAriaLabel}
                src={googleSatelliteEmbedUrl(query, zoom)}
                // Never interactive: a panned map is a route drawn against a
                // frame the briefing cannot reproduce. See the note above.
                className="pointer-events-none absolute inset-0 h-full w-full"
                loading="lazy"
                referrerPolicy="strict-origin-when-cross-origin"
              />
              {/* The click surface sits over the whole frame. A `<button>`
                  rather than a bare div so it is a real control with a name,
                  and so a tap on a phone behaves like a tap and not a drag. */}
              <button
                type="button"
                aria-label={copy.mapAriaLabel}
                onClick={addPoint}
                className="absolute inset-0 h-full w-full cursor-crosshair"
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
                {points.map((point, index) => (
                  <circle
                    // Waypoints have no identity beyond their position in the
                    // route, and two clicks can land on the same spot — the
                    // index is the only stable key here.
                    // biome-ignore lint/suspicious/noArrayIndexKey: see above
                    key={index}
                    cx={point.x}
                    cy={point.y}
                    r="2.4"
                    fill={
                      index === 0
                        ? "var(--primary)"
                        : index === points.length - 1
                          ? "var(--accent)"
                          : "var(--surface)"
                    }
                    stroke="var(--surface)"
                    strokeWidth="1.1"
                    vectorEffect="non-scaling-stroke"
                  />
                ))}
              </svg>
            </div>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <p className="mr-auto text-sm text-muted" aria-live="polite">
              {status}
            </p>
            {/* Zoom is the *only* way the frame moves — see the note above on
                why the map itself cannot be panned. Each button says what it
                does, so the pair carries no group label of its own. */}
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
              className={buttonClass({ variant: "ghost", size: "sm" })}
            >
              {copy.clear}
            </button>
          </div>
        </>
      ) : (
        <p className="mt-4 rounded-lg border border-border bg-surface-sunken p-3 text-sm text-muted">
          {copy.needsCoordinates}
        </p>
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
    </fieldset>
  );
}
