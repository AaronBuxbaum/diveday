/**
 * Map URLs, built from a plain-text location query.
 *
 * Deliberately provider-URL-only: no key, no SDK, no runtime dependency. Both
 * callers (a dive site's terrain briefing, a shop's "where to find us" card)
 * only need an `<iframe>` src and a link out to a real maps app, and an
 * embed URL is the one thing Google serves without an API key.
 *
 * Nothing here decides *whether* to draw a map — a caller that can't build an
 * honest query (a shop with no address on file) must not pass a half-empty
 * one, because the embed will happily centre on whatever it can match and
 * quietly show the wrong town.
 */

/** The plain roadmap embed — the one a diver reads to find a street. */
export function googleMapEmbedUrl(query: string): string {
  return `https://maps.google.com/maps?hl=en&q=${encodeURIComponent(query)}&z=15&output=embed`;
}

/**
 * The terrain embed, for a dive site — `t=p`, Google's topographic style.
 *
 * It used to be `t=k`, the satellite view. A satellite photo of open water is a
 * flat blue rectangle: it shows a shop's route drawn over nothing readable, and
 * the one thing a diver actually wants from a map of a dive site — how the
 * bottom is shaped, where the shallows give way to the drop — is exactly what
 * the photo cannot show. Terrain renders bathymetric shading and depth contours
 * offshore, so the same drawn line now sits over the reef it describes. The
 * coastline is still there for orientation; what is gone is the featureless
 * blue that made the frame look broken.
 *
 * What `t=p` buys, precisely: the classic embed translates the map type into one
 * bit, so `t=p` and `t=m` both resolve to Google's base map (`5e0` in the
 * `pb=` payload it redirects to) and `t=k`/`t=h` to imagery (`5e1`). This asks
 * for *not satellite*, and the bathymetric shading comes with the base map
 * rather than from a separate terrain layer — worth knowing before anyone
 * "fixes" a style parameter that looks inert.
 *
 * **`ll=`, not `q=`, and that is the whole point of taking coordinates.** A
 * `q=` embed is a *search*, and Google answers a search by dropping its pin on
 * the result — dead centre of the frame, which is exactly where the shop's
 * route is drawn. `ll=` centres the same map on the same point and asks nothing,
 * so no pin. (Confirmed against the live redirect: `q=` yields a `!2m1!1s<query>`
 * search term, `ll=` a plain `!2d<lng>!3d<lat>` viewport, both keeping the
 * `!6i<zoom>` and map-type bits.) The shop's own "where to find us" card keeps
 * {@link googleMapEmbedUrl} and its pin, because there a pin is the answer.
 *
 * `zoom` is a parameter rather than the constant it used to be because a dive
 * site's route is drawn as percentages *of this frame* — so the zoom a shop
 * drew at has to be the zoom every reader sees, or the line lands on the wrong
 * water (src/lib/dive-site-route.ts).
 */
export function googleTerrainEmbedUrl(coordinates: string, zoom = 15): string {
  return `https://maps.google.com/maps?hl=en&ll=${encodeURIComponent(coordinates)}&t=p&z=${zoom}&output=embed`;
}

/** A link out to the reader's own maps app, for directions. */
export function googleMapsUrl(query: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}
