import { createSitePopup } from "./map-markup";
import type { MapPin, MapPinDetails } from "./SiteMap";

/** Update only the facts, never the link a keyboard user may already be focused on. */
export async function loadSitePopupDetails(
  popup: HTMLElement,
  pin: MapPin,
  load: (id: string) => Promise<MapPinDetails | null>,
  words: { loading: string; unavailable: string },
): Promise<boolean> {
  const body = popup.querySelector(".leaflet-site-card__body");
  if (!body) return false;
  body.setAttribute("aria-busy", "true");
  body.querySelector('[role="status"]')?.remove();
  const status = document.createElement("p");
  status.className = "leaflet-site-card__description";
  status.setAttribute("role", "status");
  status.textContent = words.loading;
  body.append(status);
  try {
    const details = await load(pin.id);
    if (!details) throw new Error("missing published site");
    const resolved = createSitePopup({ ...pin, ...details });
    body
      .querySelectorAll(".leaflet-site-card__facts, .leaflet-site-card__description")
      .forEach((node) => {
        node.remove();
      });
    for (const node of resolved.querySelectorAll(
      ".leaflet-site-card__facts, .leaflet-site-card__description",
    ))
      body.append(node);
    return true;
  } catch {
    // No exception detail crosses into the UI. The preview link always remains usable.
    status.textContent = words.unavailable;
    return false;
  } finally {
    body.setAttribute("aria-busy", "false");
  }
}
