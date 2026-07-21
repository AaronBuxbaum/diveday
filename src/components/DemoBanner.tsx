"use client";

import { useState, useTransition } from "react";
import { resetDemoAction, switchDemoRoleAction } from "@/app/actions/demo";
import { SubmitButton } from "@/components/SubmitButton";

interface DemoBannerProps {
  currentRole: "owner" | "instructor" | "divemaster" | "captain" | "diver";
  currentName?: string | null;
  shopSlug: string;
  /** Roles that have a seeded person in this shop; others are hidden. */
  availableRoles: string[];
}

const ROLES_INFO = [
  {
    id: "owner",
    title: "Admin / Owner",
    name: "Dana Reyes",
    icon: "👑",
    desc: "Full business control. Create trips, manage staff, and view operational reports.",
    tryThis: "Check the Reports dashboard or schedule a trip.",
  },
  {
    id: "instructor",
    title: "Instructor",
    name: "Marcus Webb",
    icon: "🎓",
    desc: "Assigned to teach courses. Focuses on student certification safety gating.",
    tryThis: "Open a Discover Scuba course trip to see staff assignments.",
  },
  {
    id: "divemaster",
    title: "Divemaster",
    name: "Keiko Tanaka",
    icon: "🤿",
    desc: "Guides divers, verifies waiver paperwork, and keeps rental fit up to date.",
    tryThis: "Check Waivers, or open a trip's prep list to see what to pull.",
  },
  {
    id: "captain",
    title: "Captain",
    name: "Sal Moretti",
    icon: "⚓",
    desc: "Vessel safety and passenger manifests. Performs check-in and final roll call.",
    tryThis: "Open an upcoming trip manifest and run the passenger roll call.",
  },
  {
    id: "diver",
    title: "Diver",
    name: "Public Guest",
    icon: "🐬",
    desc: "The public-facing booking flow. Browse schedules, submit waivers, and request rentals.",
    tryThis: "Pick a trip on the schedule and book a spot.",
  },
] as const;

export function DemoBanner({
  currentRole,
  currentName,
  shopSlug,
  availableRoles,
}: DemoBannerProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [switchingTo, setSwitchingTo] = useState<string | null>(null);

  const activeInfo = ROLES_INFO.find((r) => r.id === currentRole);
  const roles = ROLES_INFO.filter((role) => availableRoles.includes(role.id));

  const handleRoleSwitch = (roleId: string) => {
    if (roleId === currentRole) return;
    setSwitchingTo(roleId);
    startTransition(async () => {
      try {
        await switchDemoRoleAction(roleId, shopSlug);
      } catch (err) {
        console.error("Failed to switch demo role:", err);
      } finally {
        setSwitchingTo(null);
      }
    });
    setIsExpanded(false);
  };

  return (
    <div className="border-b border-accent/40 bg-accent/5 transition-all duration-300 print:hidden">
      <div className="mx-auto w-full max-w-4xl px-6 py-3">
        {/* Ribbon Bar */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-2.5">
            <span className="inline-flex items-center rounded-md border border-accent/30 bg-accent/15 px-2 py-0.5 text-xs font-semibold tracking-wide text-foreground uppercase">
              Demo Playground
            </span>
            <p className="text-sm text-foreground">
              Viewing as{" "}
              <span className="font-semibold text-primary">
                {activeInfo?.icon} {activeInfo?.title}
              </span>
              {currentName && currentRole !== "diver" ? (
                <span className="text-muted text-xs"> ({currentName})</span>
              ) : null}
            </p>
          </div>

          <div className="flex items-center gap-2 self-end sm:self-auto">
            <button
              type="button"
              onClick={() => setIsExpanded(!isExpanded)}
              className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-1.5 text-sm font-medium text-foreground transition-all duration-200 hover:bg-surface-sunken cursor-pointer"
            >
              Switch Role {isExpanded ? "▲" : "▼"}
            </button>
            <form action={resetDemoAction} className="shrink-0">
              <SubmitButton
                pendingLabel="Resetting…"
                className="min-h-9 rounded-lg border border-border bg-surface px-3 py-1.5 text-sm font-medium text-foreground transition-colors duration-200 hover:bg-surface-sunken disabled:opacity-70 cursor-pointer"
              >
                Reset demo data
              </SubmitButton>
            </form>
          </div>
        </div>

        {/* Expandable Role Switched Panel */}
        {isExpanded ? (
          <div className="mt-4 border-t border-border/60 pt-4">
            <h3 className="text-sm font-semibold tracking-tight text-foreground">
              Choose a role to experience DiveDay from different perspectives:
            </h3>
            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
              {roles.map((role) => {
                const isActive = role.id === currentRole;
                const isThisSwitching = switchingTo === role.id;
                return (
                  <div
                    key={role.id}
                    className={`flex flex-col justify-between rounded-xl border bg-surface p-4 transition-all duration-200 ${
                      isActive
                        ? "border-primary shadow-sm ring-1 ring-primary/25"
                        : "border-border hover:border-primary/30 hover:shadow-xs"
                    }`}
                  >
                    <div>
                      <div className="flex items-center justify-between gap-1.5">
                        <span className="text-sm font-semibold tracking-tight text-foreground">
                          {role.icon} {role.title}
                        </span>
                        {isActive ? (
                          <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">
                            Active
                          </span>
                        ) : null}
                      </div>
                      <p className="mt-0.5 text-xs text-muted font-medium">{role.name}</p>
                      <p className="mt-2 text-xs text-muted leading-relaxed">{role.desc}</p>
                      <div className="mt-3 rounded-lg bg-surface-sunken/50 p-2 text-xs border border-border/40">
                        <span className="font-semibold text-foreground">💡 Try:</span>{" "}
                        <span className="text-muted">{role.tryThis}</span>
                      </div>
                    </div>

                    <button
                      type="button"
                      disabled={isActive || isPending}
                      aria-label={isActive ? undefined : `Switch to ${role.title}`}
                      onClick={() => handleRoleSwitch(role.id)}
                      className={`mt-4 w-full rounded-lg py-1.5 text-xs font-semibold transition-all duration-200 cursor-pointer ${
                        isActive
                          ? "bg-surface-sunken text-muted border border-border cursor-not-allowed"
                          : "bg-primary text-primary-foreground hover:bg-primary-hover shadow-xs active:scale-[0.98] disabled:opacity-50"
                      }`}
                    >
                      {isThisSwitching ? (
                        <span className="inline-flex items-center gap-1 justify-center w-full">
                          <span
                            className="h-1.5 w-1.5 animate-bounce rounded-full bg-current"
                            style={{ animationDelay: "0ms" }}
                          />
                          <span
                            className="h-1.5 w-1.5 animate-bounce rounded-full bg-current"
                            style={{ animationDelay: "150ms" }}
                          />
                          <span
                            className="h-1.5 w-1.5 animate-bounce rounded-full bg-current"
                            style={{ animationDelay: "300ms" }}
                          />
                        </span>
                      ) : isActive ? (
                        "Current"
                      ) : (
                        "Switch"
                      )}
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
