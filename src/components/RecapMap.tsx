"use client";

import type { RecapSite } from "@/db/recap";

export function RecapMap({
  sites,
  copy,
}: {
  sites: RecapSite[];
  copy: {
    mapAriaLabel: string;
    charterPath: string;
    boatTrack: string;
    theDock: string;
    reconstructedPath: string;
  };
}) {
  if (sites.length === 0) return null;

  // A geographic map must never imply a location that the shop did not save.
  // Omit it until every plotted site has both coordinates.
  if (sites.some((site) => site.forecastLatitude === null || site.forecastLongitude === null)) {
    return null;
  }

  const mapSites = sites as {
    name: string;
    forecastLatitude: number;
    forecastLongitude: number;
  }[];
  const lats = mapSites.map((site) => site.forecastLatitude);
  const lngs = mapSites.map((site) => site.forecastLongitude);

  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);
  const rawLatDiff = maxLat - minLat;
  const rawLngDiff = maxLng - minLng;
  const latPadding = rawLatDiff > 0 ? rawLatDiff * 0.25 : 0.1;
  const lngPadding = rawLngDiff > 0 ? rawLngDiff * 0.25 : 0.1;
  const plotMinLat = minLat - latPadding;
  const plotMaxLat = maxLat + latPadding;
  const plotMinLng = minLng - lngPadding;
  const plotMaxLng = maxLng + lngPadding;
  const latDiff = plotMaxLat - plotMinLat;
  const lngDiff = plotMaxLng - plotMinLng;
  const padding = 50;
  const width = 450;
  const height = 280;

  const getXY = (lat: number, lng: number) => ({
    x: padding + ((lng - plotMinLng) / lngDiff) * (width - 2 * padding),
    y: height - padding - ((lat - plotMinLat) / latDiff) * (height - 2 * padding),
  });

  const dockXY = getXY(
    minLat - rawLatDiff * 0.1 - (rawLatDiff === 0 ? latPadding * 0.5 : 0),
    minLng - rawLngDiff * 0.1 - (rawLngDiff === 0 ? lngPadding * 0.5 : 0),
  );
  let pathD = `M ${dockXY.x} ${dockXY.y}`;
  for (const site of mapSites) {
    const xy = getXY(site.forecastLatitude, site.forecastLongitude);
    pathD += ` L ${xy.x} ${xy.y}`;
  }

  return (
    <div className="mt-4 overflow-hidden rounded-2xl border border-border bg-surface-sunken p-2 shadow-sm">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="h-auto w-full select-none rounded-xl bg-surface"
        aria-label={copy.mapAriaLabel}
      >
        <pattern id="recap-map-grid" width="40" height="40" patternUnits="userSpaceOnUse">
          <path
            d="M 40 0 L 0 0 0 40"
            fill="none"
            stroke="var(--primary)"
            strokeWidth="1"
            opacity="0.12"
          />
        </pattern>
        <rect width="100%" height="100%" fill="url(#recap-map-grid)" />

        <text x="60" y="80" className="select-none text-xl opacity-30">
          🐬
        </text>
        <text x="350" y="220" className="select-none text-xl opacity-30">
          🐢
        </text>
        <text x="280" y="70" className="select-none text-lg opacity-20">
          ⛵
        </text>

        <g transform={`translate(${width - 45}, 45)`} className="opacity-45">
          <circle
            r="20"
            fill="none"
            stroke="var(--primary)"
            strokeWidth="1"
            strokeDasharray="3,3"
          />
          <path
            d="M 0 -22 L 4 -4 L 22 0 L 4 4 L 0 22 L -4 4 L -22 0 L -4 -4 Z"
            fill="var(--primary)"
          />
          <path d="M 0 -22 L 0 0 L 4 -4 Z" fill="var(--surface)" opacity="0.7" />
          <path d="M 22 0 L 0 0 L 4 4 Z" fill="var(--surface)" opacity="0.7" />
          <path d="M 0 22 L 0 0 L -4 4 Z" fill="var(--surface)" opacity="0.7" />
          <path d="M -22 0 L 0 0 L -4 -4 Z" fill="var(--surface)" opacity="0.7" />
          <text y="-25" textAnchor="middle" className="fill-primary text-[9px] font-bold">
            N
          </text>
        </g>

        <g transform="translate(15, 20)" className="opacity-60">
          <rect
            width="90"
            height="40"
            rx="4"
            fill="var(--surface)"
            stroke="var(--primary)"
            strokeWidth="0.5"
            opacity="0.9"
          />
          <text x="8" y="15" className="fill-foreground text-[8px] font-bold tracking-wider">
            {copy.charterPath}
          </text>
          <line
            x1="8"
            y1="26"
            x2="35"
            y2="26"
            stroke="var(--primary)"
            strokeWidth="2"
            strokeDasharray="4,3"
          />
          <text x="42" y="30" className="fill-muted text-[8px]">
            {copy.boatTrack}
          </text>
        </g>

        <path
          d={pathD}
          fill="none"
          stroke="var(--primary)"
          strokeWidth="2.5"
          strokeDasharray="6,5"
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity="0.75"
        />

        <g transform={`translate(${dockXY.x}, ${dockXY.y})`}>
          <circle r="5" fill="var(--primary)" stroke="var(--surface)" strokeWidth="1.5" />
          <text
            y="-10"
            textAnchor="middle"
            className="fill-foreground text-[9px] font-bold tracking-wider uppercase"
            stroke="var(--surface)"
            strokeWidth="3"
            paintOrder="stroke"
          >
            {copy.theDock}
          </text>
        </g>

        {mapSites.map((site) => {
          const xy = getXY(site.forecastLatitude, site.forecastLongitude);
          return (
            <g key={site.name} transform={`translate(${xy.x}, ${xy.y})`}>
              {/* `data-live-pulse`: this pulses for as long as the map is on screen, so
                  it is not a skeleton. Screenshot tooling waits for the last
                  `animate-pulse` to leave `<main>` before it shoots, and without
                  this marker that wait could never be satisfied here. */}
              <circle
                r="14"
                fill="var(--primary)"
                opacity="0.2"
                className="animate-pulse"
                data-live-pulse=""
              />
              <circle r="6" fill="var(--primary)" stroke="var(--surface)" strokeWidth="2" />
              <text
                y="-11"
                textAnchor="middle"
                className="fill-foreground font-sans text-[10px] font-bold tracking-wide"
                stroke="var(--surface)"
                strokeWidth="3"
                paintOrder="stroke"
              >
                {site.name}
              </text>
            </g>
          );
        })}
      </svg>
      <div className="p-2 text-center text-xs text-muted">{copy.reconstructedPath}</div>
    </div>
  );
}
