import { getSeedDiveSiteMap, googleMapsUrl, googleSatelliteEmbedUrl } from "@/lib/dive-site-map";

export function DiveSiteMap({ siteName }: { siteName: string }) {
  const map = getSeedDiveSiteMap(siteName);
  if (!map) return null;

  return (
    <figure className="overflow-hidden border-b border-border bg-surface-sunken">
      <div className="relative h-64 overflow-hidden sm:h-80">
        <iframe
          title={`Satellite map of ${siteName}`}
          src={googleSatelliteEmbedUrl(map.query)}
          className="absolute inset-0 h-full w-full"
          loading="lazy"
          referrerPolicy="strict-origin-when-cross-origin"
        />
        <svg
          viewBox="0 0 100 100"
          className="pointer-events-none absolute inset-0 h-full w-full"
          aria-hidden="true"
          preserveAspectRatio="none"
        >
          <path
            d={map.path}
            fill="none"
            stroke="var(--accent)"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2.25"
            vectorEffect="non-scaling-stroke"
          />
          <circle
            cx={map.start.x}
            cy={map.start.y}
            r="2.4"
            fill="var(--primary)"
            stroke="var(--surface)"
            strokeWidth="1.1"
            vectorEffect="non-scaling-stroke"
          />
          <circle
            cx={map.finish.x}
            cy={map.finish.y}
            r="2.4"
            fill="var(--accent)"
            stroke="var(--surface)"
            strokeWidth="1.1"
            vectorEffect="non-scaling-stroke"
          />
        </svg>
        <div className="pointer-events-none absolute right-3 bottom-3 rounded-full bg-surface/90 px-3 py-1.5 text-xs font-medium text-foreground shadow-sm backdrop-blur-sm">
          Satellite view · illustrative route
        </div>
      </div>
      <figcaption className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-5 py-3 text-sm sm:px-6">
        <div>
          <p className="font-medium">{map.routeLabel}</p>
          <p className="mt-0.5 text-muted">{map.routeDescription}</p>
        </div>
        <a
          href={googleMapsUrl(map.query)}
          target="_blank"
          rel="noreferrer"
          className="min-h-11 shrink-0 content-center text-sm font-medium text-primary hover:underline"
        >
          Open map ↗
        </a>
      </figcaption>
    </figure>
  );
}
