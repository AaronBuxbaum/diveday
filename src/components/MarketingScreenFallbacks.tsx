function AppBar({ label }: { label: string }) {
  return (
    <div className="flex items-center justify-between border-b border-border bg-surface px-4 py-3 text-xs text-muted">
      <span className="font-semibold tracking-wide text-primary uppercase">Blue Mantis Divers</span>
      <span>{label}</span>
    </div>
  );
}

export function CaptainRollCallFallback() {
  return (
    <div className="bg-background">
      <AppBar label="Live manifest · online" />
      <div className="space-y-4 p-4">
        <div>
          <p className="text-xs font-medium tracking-widest text-primary uppercase">
            Boat manifest
          </p>
          <h3 className="mt-1 text-lg font-semibold tracking-tight">Two-Tank Reef</h3>
          <p className="text-xs text-muted">Today · 7:30–11:00 AM</p>
        </div>
        <div className="grid grid-cols-3 gap-2 text-center">
          {[
            ["Divers", "9"],
            ["Ready", "7"],
            ["Boarded", "4"],
          ].map(([label, value]) => (
            <div key={label} className="rounded-lg border border-border bg-surface p-2">
              <p className="text-[10px] font-medium text-muted uppercase">{label}</p>
              <p className="mt-0.5 text-lg font-semibold tabular-nums">{value}</p>
            </div>
          ))}
        </div>
        <div>
          <h3 className="text-sm font-semibold">Roll call</h3>
          <div className="mt-2 space-y-2">
            {["Priya Sharma", "Tom Okafor"].map((name) => (
              <div key={name} className="rounded-lg border border-border bg-surface p-3">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold">{name}</p>
                    <p className="text-xs text-success">Ready to board</p>
                  </div>
                  <button
                    type="button"
                    disabled
                    className="min-h-11 rounded-lg bg-primary px-3 text-xs font-semibold text-primary-foreground"
                  >
                    Mark boarded
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export function FrontDeskReadinessFallback() {
  return (
    <div className="bg-background">
      <AppBar label="Trip detail" />
      <div className="p-5">
        <p className="text-xs font-medium tracking-widest text-primary uppercase">Readiness</p>
        <h3 className="mt-1 text-xl font-semibold tracking-tight">The answer before the dock</h3>
        <p className="mt-1 text-sm text-muted">Unknown evidence never clears a diver.</p>
        <div className="mt-4 divide-y divide-border rounded-xl border border-border bg-surface">
          {[
            ["Priya Sharma", "Waiver needs attention", "text-danger"],
            ["Lena Fischer", "Ready to board", "text-success"],
            ["Diego Alvarez", "Certification pending", "text-warning"],
          ].map(([name, status, tone]) => (
            <div key={name} className="flex items-center justify-between gap-3 px-4 py-3">
              <p className="text-sm font-semibold">{name}</p>
              <p className={`text-xs font-medium ${tone}`}>{status}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function DiverBookingFallback() {
  return (
    <div className="bg-background">
      <AppBar label="Schedule" />
      <div className="p-5">
        <p className="text-xs font-medium tracking-widest text-primary uppercase">Upcoming trips</p>
        <h3 className="mt-1 text-xl font-semibold tracking-tight">Find your next dive</h3>
        <div className="mt-4 space-y-3">
          {[
            ["Two-Tank Reef", "Tomorrow · 7:30 AM", "3 spots left"],
            ["Night Dive", "Friday · 6:00 PM", "5 spots left"],
          ].map(([title, time, availability]) => (
            <div key={title} className="rounded-xl border border-border bg-surface p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h4 className="font-semibold">{title}</h4>
                  <p className="mt-1 text-sm text-muted">{time}</p>
                </div>
                <span className="rounded-full bg-primary/10 px-2.5 py-1 text-xs font-semibold text-primary">
                  {availability}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
