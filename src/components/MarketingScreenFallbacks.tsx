import { diverTranslator } from "@/i18n/messages";
import { requestLocale } from "@/i18n/request";

function AppBar({ label }: { label: string }) {
  return (
    <div className="flex items-center justify-between border-b border-border bg-surface px-4 py-3 text-xs text-muted">
      {/* i18n-exempt: sample shop name used only in marketing mockups */}
      <span className="font-semibold tracking-wide text-primary uppercase">Blue Mantis Divers</span>
      <span>{label}</span>
    </div>
  );
}

export async function CaptainRollCallFallback() {
  const t = diverTranslator(await requestLocale());
  return (
    <div className="bg-background">
      <AppBar label={t("fallback.offlineCopy")} />
      <div className="space-y-4 p-4">
        <div>
          <p className="text-xs font-medium tracking-widest text-primary uppercase">
            {t("fallback.boatManifest")}
          </p>
          <h3 className="mt-1 text-lg font-semibold tracking-tight">{t("fallback.tripName")}</h3>
          <p className="text-xs text-muted">{t("fallback.tripTime")}</p>
        </div>
        <div className="grid grid-cols-3 gap-2 text-center">
          {[
            [t("fallback.diversLabel"), "9"],
            [t("fallback.readyLabel"), "7"],
            [t("fallback.boardedLabel"), "4"],
          ].map(([label, value]) => (
            <div key={label} className="rounded-lg border border-border bg-surface p-2">
              <p className="text-[10px] font-medium text-muted uppercase">{label}</p>
              <p className="mt-0.5 text-lg font-semibold tabular-nums">{value}</p>
            </div>
          ))}
        </div>
        <div>
          <h3 className="text-sm font-semibold">{t("fallback.rollCall")}</h3>
          <div className="mt-2 space-y-2">
            {/* i18n-exempt: sample diver names used only in marketing mockups */}
            {["Priya Sharma", "Tom Okafor"].map((name) => (
              <div key={name} className="rounded-lg border border-border bg-surface p-3">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold">{name}</p>
                    <p className="text-xs text-success">{t("fallback.readyToBoard")}</p>
                  </div>
                  <button
                    type="button"
                    disabled
                    className="inline-flex min-h-11 items-center justify-center rounded-lg bg-primary px-3 text-xs font-semibold text-primary-foreground"
                  >
                    {t("fallback.markBoarded")}
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

export async function FrontDeskReadinessFallback() {
  const t = diverTranslator(await requestLocale());
  const rows = [
    { name: "Priya Sharma", status: t("fallback.waiverNeedsAttention"), tone: "text-danger" },
    { name: "Lena Fischer", status: t("fallback.readyToBoard"), tone: "text-success" },
    { name: "Diego Alvarez", status: t("fallback.certificationPending"), tone: "text-warning" },
  ];
  return (
    <div className="bg-background">
      <AppBar label={t("fallback.tripDetail")} />
      <div className="p-5">
        <p className="text-xs font-medium tracking-widest text-primary uppercase">
          {t("fallback.readiness")}
        </p>
        <h3 className="mt-1 text-xl font-semibold tracking-tight">
          {t("fallback.answerBeforeDock")}
        </h3>
        <p className="mt-1 text-sm text-muted">{t("fallback.noDiverClears")}</p>
        <div className="mt-4 divide-y divide-border rounded-xl border border-border bg-surface">
          {/* i18n-exempt: sample diver names used only in marketing mockups */}
          {rows.map(({ name, status, tone }) => (
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

export async function DiverBookingFallback() {
  const t = diverTranslator(await requestLocale());
  const trips = [
    { title: t("fallback.tripName"), time: t("fallback.tomorrowTime"), spots: 3 },
    { title: t("fallback.nightDive"), time: t("fallback.fridayTime"), spots: 5 },
  ];
  return (
    <div className="bg-background">
      <AppBar label={t("fallback.schedule")} />
      <div className="p-5">
        <p className="text-xs font-medium tracking-widest text-primary uppercase">
          {t("fallback.upcomingTrips")}
        </p>
        <h3 className="mt-1 text-xl font-semibold tracking-tight">{t("fallback.findNextDive")}</h3>
        <div className="mt-4 space-y-3">
          {trips.map((trip) => (
            <div key={trip.title} className="rounded-xl border border-border bg-surface p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h4 className="font-semibold">{trip.title}</h4>
                  <p className="mt-1 text-sm text-muted">{trip.time}</p>
                </div>
                <span className="rounded-full bg-primary/10 px-2.5 py-1 text-xs font-semibold text-primary">
                  {t("fallback.spotsLeft", { count: trip.spots })}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
