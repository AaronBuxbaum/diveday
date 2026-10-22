import type { MapPin } from "./SiteMap";

/**
 * The DOM a dive-site map draws into Leaflet: the shop's landmark, a site's
 * pin, a cluster's count, and the hover label and card each opens. Text goes
 * in as text, never as markup, and a card's link only when it is http(s).
 */

const pinPath =
  "M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z";

export function createShopLandmark(label: string): HTMLSpanElement {
  const button = document.createElement("span");
  button.setAttribute("role", "img");
  button.tabIndex = 0;
  button.className =
    "leaflet-shop-landmark flex items-center justify-center size-11 rounded-full bg-foreground text-surface shadow-md ring-2 ring-surface border border-border";
  button.setAttribute("aria-label", label);
  button.addEventListener("mousedown", (event) => event.stopPropagation());
  button.addEventListener("keypress", (event) => event.stopPropagation());

  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", "size-4");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");

  const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
  circle.setAttribute("cx", "12");
  circle.setAttribute("cy", "5");
  circle.setAttribute("r", "3");
  const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
  line.setAttribute("x1", "12");
  line.setAttribute("y1", "22");
  line.setAttribute("x2", "12");
  line.setAttribute("y2", "8");
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", "M5 12H2a10 10 0 0 0 20 0h-3");
  svg.append(circle, line, path);
  button.append(svg);
  return button;
}

export function createSiteButton(
  pin: MapPin,
  colorClass: string,
  ringClass: string,
): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `group flex items-center justify-center size-11 rounded-full ${colorClass} shadow-md border border-border transition-transform ${ringClass}`;
  button.setAttribute("aria-label", pin.name);
  button.addEventListener("mousedown", (event) => event.stopPropagation());
  button.addEventListener("keypress", (event) => event.stopPropagation());

  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", "size-5");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "currentColor");
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", pinPath);
  svg.append(path);
  button.append(svg);
  return button;
}

export function createClusterButton(count: number, label: string): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "leaflet-site-cluster";
  button.setAttribute("aria-label", label);
  button.addEventListener("mousedown", (event) => event.stopPropagation());
  button.addEventListener("keypress", (event) => event.stopPropagation());
  const countLabel = document.createElement("span");
  countLabel.textContent = String(count);
  button.append(countLabel);
  return button;
}

export function createSiteTooltip(pin: MapPin): HTMLDivElement {
  const tooltip = document.createElement("div");
  const name = document.createElement("span");
  name.className = "leaflet-site-tooltip__name";
  name.textContent = pin.name;
  tooltip.append(name);

  if (pin.details?.length) {
    const subtitle = document.createElement("span");
    subtitle.className = "leaflet-site-tooltip__location";
    subtitle.textContent = pin.details.join(" · ");
    tooltip.append(subtitle);
  }

  return tooltip;
}

export function createSitePopup(pin: MapPin): HTMLElement {
  const article = document.createElement("article");
  article.className = "leaflet-site-card";
  const body = document.createElement("div");
  body.className = "leaflet-site-card__body";

  const title = document.createElement("h2");
  title.className = "leaflet-site-card__title";
  title.textContent = pin.name;
  body.append(title);

  if (pin.subtitle) {
    const subtitle = document.createElement("p");
    subtitle.className = "leaflet-site-card__location";
    subtitle.textContent = pin.subtitle;
    body.append(subtitle);
  }

  const details = (pin.details ?? []).filter(Boolean);
  if (details.length > 0) {
    const facts = document.createElement("ul");
    facts.className = "leaflet-site-card__facts";
    for (const detail of details) {
      const fact = document.createElement("li");
      fact.className = "leaflet-site-card__fact";
      fact.textContent = detail;
      facts.append(fact);
    }
    body.append(facts);
  }

  if (pin.description) {
    const description = document.createElement("p");
    description.className = "leaflet-site-card__description";
    description.textContent = pin.description;
    body.append(description);
  }

  article.append(body);
  const href = safeHref(pin.href);
  if (href && pin.hrefLabel) {
    const link = document.createElement("a");
    link.href = href;
    link.className = "leaflet-site-card__link";
    link.textContent = pin.hrefLabel;
    const arrow = document.createElement("span");
    arrow.setAttribute("aria-hidden", "true");
    arrow.textContent = " →";
    link.append(arrow);
    article.append(link);
  }

  return article;
}

export function createClusterPopup(pins: MapPin[], clusterLabel: string): HTMLElement {
  const section = document.createElement("section");
  section.className = "leaflet-site-cluster-card";
  const title = document.createElement("h2");
  title.className = "leaflet-site-cluster-card__title";
  title.textContent = `${pins.length} ${clusterLabel}`;
  section.append(title);

  const list = document.createElement("ul");
  list.className = "leaflet-site-cluster-card__list";
  for (const pin of pins) {
    const item = document.createElement("li");
    item.className = "leaflet-site-cluster-card__item";

    const href = safeHref(pin.href);
    if (href) {
      const name = document.createElement("a");
      name.href = href;
      name.className = "leaflet-site-cluster-card__name";
      name.textContent = pin.name;
      item.append(name);
    } else {
      const name = document.createElement("span");
      name.className = "leaflet-site-cluster-card__name";
      name.textContent = pin.name;
      item.append(name);
    }

    if (pin.subtitle) {
      const subtitle = document.createElement("span");
      subtitle.className = "leaflet-site-cluster-card__location";
      subtitle.textContent = pin.subtitle;
      item.append(subtitle);
    }

    const details = (pin.details ?? []).filter(Boolean);
    if (details.length > 0) {
      const facts = document.createElement("span");
      facts.className = "leaflet-site-cluster-card__facts";
      facts.textContent = details.join(" · ");
      item.append(facts);
    }

    list.append(item);
  }

  section.append(list);
  return section;
}

function safeHref(href?: string): string | null {
  if (!href) return null;
  const anchor = document.createElement("a");
  anchor.href = href;
  return anchor.protocol === "http:" || anchor.protocol === "https:" ? href : null;
}
