/**
 * Map URLs, built from a plain-text location query.
 *
 * Deliberately provider-URL-only: no key, no SDK, no runtime dependency. Both
 * callers (a dive site's satellite briefing, a shop's "where to find us" card)
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
 * The satellite embed, for a dive site where the water tells the story.
 *
 * `zoom` is a parameter rather than the constant it used to be because a dive
 * site's route is drawn as percentages *of this frame* — so the zoom a shop
 * drew at has to be the zoom every reader sees, or the line lands on the wrong
 * water (src/lib/dive-site-route.ts).
 */
export function googleSatelliteEmbedUrl(query: string, zoom = 15): string {
  return `https://maps.google.com/maps?hl=en&q=${encodeURIComponent(query)}&t=k&z=${zoom}&output=embed`;
}

/** A link out to the reader's own maps app, for directions. */
export function googleMapsUrl(query: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}
