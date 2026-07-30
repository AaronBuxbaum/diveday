"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { switchDemoRoleAction } from "@/app/actions/demo";
import { buttonClass } from "@/components/ui/button";

/** One role card's full content, resolved server-side (icon/name are data, the rest is translated copy). */
interface DemoRoleInfo {
  id: "owner" | "instructor" | "divemaster" | "captain" | "diver";
  icon: string;
  name: string;
  title: string;
  desc: string;
  tryThis: string;
}

interface DemoBannerCopy {
  shopLabel: string;
  viewingAs: string;
  switchRole: string;
  sharedWarning: string;
  sessionExpired: string;
  withCredentials: string;
  chooseRole: string;
  active: string;
  tryLabel: string;
  current: string;
  switchAction: string;
  switchToAria: (role: string) => string;
}

interface DemoBannerProps {
  currentRole: "owner" | "instructor" | "divemaster" | "captain" | "diver";
  currentName?: string | null;
  shopSlug: string;
  /** Every role this shop can show, in display order, already filtered to who's seeded. */
  roles: DemoRoleInfo[];
  copy: DemoBannerCopy;
  /**
   * A per-visitor minted demo (not the shared fixture): addressable by slug and
   * readable by anyone who has it, so it shows a "don't enter real data" notice.
   */
  isMintedDemo?: boolean;
  /** The signed-in email for `currentRole`, absent for the signed-out diver view. */
  currentEmail?: string | null;
  /** Shared plaintext sign-in password for any minted demo (src/lib/credentials.ts). */
  demoPassword?: string;
}

export function DemoBanner({
  currentRole,
  currentName,
  shopSlug,
  roles,
  copy,
  isMintedDemo = false,
  currentEmail,
  demoPassword,
}: DemoBannerProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [switchingTo, setSwitchingTo] = useState<string | null>(null);

  const activeInfo = roles.find((r) => r.id === currentRole);

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
              {copy.shopLabel}
            </span>
            <p className="text-sm text-foreground">
              {copy.viewingAs}{" "}
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
              className={buttonClass({
                variant: "secondary",
                size: "sm",
                className: "text-foreground",
              })}
            >
              {copy.switchRole} {isExpanded ? "▲" : "▼"}
            </button>
          </div>
        </div>

        {isMintedDemo ? (
          <div className="mt-2 space-y-1 text-xs text-muted">
            <p>{copy.sharedWarning}</p>
            {currentEmail && demoPassword ? (
              <p>
                {copy.sessionExpired}{" "}
                <Link href="/sign-in" className="font-medium text-primary hover:underline">
                  /sign-in
                </Link>{" "}
                {copy.withCredentials} <span className="font-mono">{currentEmail}</span> /{" "}
                <span className="font-mono">{demoPassword}</span>.
              </p>
            ) : null}
          </div>
        ) : null}

        {/* Expandable Role Switched Panel */}
        {isExpanded ? (
          <div className="mt-4 border-t border-border/60 pt-4">
            <h3 className="text-sm font-semibold tracking-tight text-foreground">
              {copy.chooseRole}
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
                            {copy.active}
                          </span>
                        ) : null}
                      </div>
                      <p className="mt-0.5 text-xs text-muted font-medium">{role.name}</p>
                      <p className="mt-2 text-xs text-muted leading-relaxed">{role.desc}</p>
                      <div className="mt-3 rounded-lg bg-surface-sunken/50 p-2 text-xs border border-border/40">
                        <span className="font-semibold text-foreground">💡 {copy.tryLabel}</span>{" "}
                        <span className="text-muted">{role.tryThis}</span>
                      </div>
                    </div>

                    <button
                      type="button"
                      disabled={isActive || isPending}
                      aria-label={isActive ? undefined : copy.switchToAria(role.title)}
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
                        copy.current
                      ) : (
                        copy.switchAction
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
