import type { DiveSiteLandmark } from "@/lib/dive-site-landmarks";

export function DiveSiteLandmarks({ landmarks }: { landmarks: DiveSiteLandmark[] }) {
  if (landmarks.length === 0) return null;

  return (
    <section className="mt-8 border-t border-border pt-8">
      <p className="text-sm font-medium tracking-widest text-primary uppercase">Look for these</p>
      <div className="mt-2 flex flex-wrap items-end justify-between gap-2">
        <h3 className="text-xl font-semibold tracking-tight">Landmarks that tell the story</h3>
        <p className="text-sm text-muted">The crew will point out the best approach.</p>
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {landmarks.map((landmark, index) => (
          <article
            key={landmark.name}
            className="relative overflow-hidden rounded-xl bg-surface-sunken p-5"
          >
            <span
              aria-hidden="true"
              className="absolute top-1 right-3 text-6xl font-semibold tracking-tighter text-primary/10"
            >
              {String(index + 1).padStart(2, "0")}
            </span>
            <p className="relative text-xs font-medium tracking-widest text-primary uppercase">
              {landmark.kind}
            </p>
            <h4 className="relative mt-2 text-lg font-semibold">{landmark.name}</h4>
            <p className="relative mt-2 max-w-prose text-sm leading-relaxed text-muted">
              {landmark.description}
            </p>
          </article>
        ))}
      </div>
    </section>
  );
}
