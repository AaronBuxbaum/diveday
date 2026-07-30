"use client";

type MissingDiver = {
  bookingId: string;
  fullName: string;
  rentsKit: boolean;
};

function getInitials(fullName: string): string {
  return fullName
    .split(" ")
    .map((name) => name[0])
    .filter(Boolean)
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function getAvatarColor(fullName: string): string {
  const colors = [
    "bg-primary text-primary-foreground border-primary-hover",
    "bg-success text-primary-foreground border-success",
    "bg-accent text-accent-foreground border-accent",
    "bg-warning text-primary-foreground border-warning",
    "bg-danger text-primary-foreground border-danger",
  ];
  let hash = 0;
  for (let index = 0; index < fullName.length; index++) {
    hash = fullName.charCodeAt(index) + ((hash << 5) - hash);
  }
  return colors[Math.abs(hash) % colors.length];
}

export function MissingDiversGrid({ divers }: { divers: MissingDiver[] }) {
  if (divers.length === 0) return null;

  return (
    <section
      id="missing-divers-grid"
      className="mt-8 rounded-2xl border border-border bg-surface-sunken p-5 print:hidden"
    >
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-bold uppercase tracking-wider text-muted">
          Missing divers ({divers.length})
        </h2>
        <span className="text-xs font-semibold text-danger bg-danger/10 px-2 py-0.5 rounded-full">
          Awaiting boarding
        </span>
      </div>
      <p className="mt-1 text-xs text-muted">
        Tap a diver&apos;s profile avatar to scroll directly to their roll-call row.
      </p>
      <div className="mt-4 flex flex-wrap gap-4 justify-start">
        {divers.map((diver) => {
          const colorClass = getAvatarColor(diver.fullName);
          return (
            <button
              key={diver.bookingId}
              type="button"
              onClick={() => {
                const element = document.getElementById(`diver-row-${diver.bookingId}`);
                if (!element) return;
                element.scrollIntoView({ behavior: "smooth", block: "center" });
                element.classList.add("ring-4", "ring-primary/50", "ring-offset-2");
                setTimeout(() => {
                  element.classList.remove("ring-4", "ring-primary/50", "ring-offset-2");
                }, 2000);
              }}
              className="group flex max-w-20 cursor-pointer flex-col items-center text-center transition-transform active:scale-95"
            >
              <div
                className={`flex h-14 w-14 items-center justify-center rounded-full border-2 text-lg font-black shadow-sm ${colorClass} transition-transform group-hover:scale-105`}
              >
                {getInitials(diver.fullName)}
              </div>
              <span
                className="mt-1 block w-full truncate text-xs font-bold text-foreground"
                title={diver.fullName}
              >
                {diver.fullName.split(" ")[0]}
              </span>
              <span className="block w-full truncate text-[10px] text-muted">
                {diver.rentsKit ? "Rentals 🤿" : "Own kit ⛵"}
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
