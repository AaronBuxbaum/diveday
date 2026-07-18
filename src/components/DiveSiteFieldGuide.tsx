type FieldGuideCreature = {
  id: string;
  name: string;
  kind: string;
  imageUrl: string | null;
  description: string | null;
  preparationTip: string | null;
};

export function DiveSiteFieldGuide({
  creatures,
  summary,
  highlights,
}: {
  creatures: FieldGuideCreature[];
  summary: string | null;
  highlights: string | null;
}) {
  if (creatures.length === 0 && !summary && !highlights) return null;
  const tips = [...new Set(creatures.map((creature) => creature.preparationTip).filter(Boolean))];

  return (
    <section className="mt-8 border-t border-border pt-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm font-medium tracking-widest text-primary uppercase">
            Reef field guide
          </p>
          <h3 className="mt-2 text-xl font-semibold tracking-tight">A few faces to learn</h3>
        </div>
        {creatures.length ? (
          <p className="text-sm tabular-nums text-muted">{creatures.length} likely sightings</p>
        ) : null}
      </div>
      {highlights ? (
        <p className="mt-4 text-sm font-semibold leading-relaxed text-primary">{highlights}</p>
      ) : null}
      {summary ? <p className="mt-2 max-w-2xl leading-relaxed text-muted">{summary}</p> : null}

      {creatures.length ? (
        <div className="mt-6 grid grid-cols-2 gap-x-3 gap-y-6 sm:grid-cols-4">
          {creatures.map((creature) => (
            <figure key={creature.id} className="min-w-0">
              {creature.imageUrl ? (
                // biome-ignore lint/performance/noImgElement: seed and staff-provided Commons imagery supports arbitrary approved hosts without a global image allowlist.
                <img
                  src={creature.imageUrl}
                  alt={creature.name}
                  className="aspect-[4/3] w-full rounded-lg bg-surface-sunken object-cover"
                />
              ) : (
                <div className="flex aspect-[4/3] items-center justify-center rounded-lg bg-primary/10 text-2xl font-semibold text-primary">
                  {creature.name.slice(0, 1)}
                </div>
              )}
              <figcaption className="pt-2">
                <p className="text-[0.7rem] font-medium tracking-widest text-primary uppercase">
                  {creature.kind}
                </p>
                <h4 className="mt-0.5 font-semibold leading-tight">{creature.name}</h4>
                {creature.description ? (
                  <p className="mt-1 text-xs leading-relaxed text-muted">{creature.description}</p>
                ) : null}
              </figcaption>
            </figure>
          ))}
        </div>
      ) : null}

      {tips.length ? (
        <aside className="mt-7 flex gap-3 rounded-xl bg-primary/10 p-4">
          <span aria-hidden="true" className="text-xl">
            ◌
          </span>
          <div>
            <h4 className="font-semibold">See more by slowing down</h4>
            <p className="mt-1 text-sm leading-relaxed text-muted">{tips.slice(0, 2).join(" ")}</p>
          </div>
        </aside>
      ) : null}
    </section>
  );
}
