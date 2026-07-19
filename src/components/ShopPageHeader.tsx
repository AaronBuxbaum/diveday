export function ShopPageHeader({
  eyebrow,
  title,
  description,
  meta,
  actions,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  meta?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <header className="mb-8">
      <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          {eyebrow ? (
            <p className="text-xs font-semibold tracking-[0.18em] text-primary uppercase">
              {eyebrow}
            </p>
          ) : null}
          <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">{title}</h1>
          {description ? <p className="mt-2 max-w-2xl text-muted">{description}</p> : null}
          {meta ? <div className="mt-3">{meta}</div> : null}
        </div>
        {actions ? <div className="flex shrink-0 flex-wrap gap-2">{actions}</div> : null}
      </div>
    </header>
  );
}

export function ShopStat({
  label,
  value,
  detail,
  tone = "default",
}: {
  label: string;
  value: string | number;
  detail: string;
  tone?: "default" | "primary" | "warning" | "success";
}) {
  const toneClass =
    tone === "primary"
      ? "bg-primary/10 text-primary"
      : tone === "warning"
        ? "bg-warning/10 text-warning"
        : tone === "success"
          ? "bg-success/10 text-success"
          : "bg-surface-sunken text-foreground";

  return (
    <div className="rounded-2xl border border-border bg-surface p-4 shadow-sm sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm font-medium text-muted">{label}</p>
        <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${toneClass}`}>
          {value}
        </span>
      </div>
      <p className="mt-3 text-sm text-muted">{detail}</p>
    </div>
  );
}

export function ShopNotice({
  children,
  tone = "success",
  role = "status",
}: {
  children: React.ReactNode;
  tone?: "success" | "danger" | "warning" | "neutral";
  role?: "status" | "alert";
}) {
  const toneClass =
    tone === "danger"
      ? "border-danger/20 bg-danger/10 text-danger"
      : tone === "warning"
        ? "border-warning/25 bg-warning/10 text-foreground"
        : tone === "neutral"
          ? "border-border bg-surface-sunken text-foreground"
          : "border-success/20 bg-success/10 text-success";

  return (
    <div role={role} className={`rounded-xl border px-4 py-3 text-sm font-medium ${toneClass}`}>
      {children}
    </div>
  );
}
