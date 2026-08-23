"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { buttonClass } from "@/components/ui/button";

/** One role card's full content, resolved server-side (icon/name are data, the rest is translated copy). */
interface DemoRoleInfo {
  id: "owner" | "instructor" | "divemaster" | "captain" | "diver";
  icon: string;
  name: string;
  title: string;
  desc: string;
  tryThis: string;
  /** "Switch to {title}" pre-formatted server-side — functions can't cross into a Client Component. */
  switchAriaLabel: string;
}

interface DemoBannerCopy {
  shopLabel: string;
  viewingAs: string;
  switchRole: string;
  sharedWarning: string;
  sessionExpired: string;
  withCredentials: string;
  active: string;
  tryLabel: string;
  current: string;
  switchAction: string;
  /** Shown when `switchDemoRoleAction` throws — the tap must not fail silently. */
  switchFailed: string;
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
  /**
   * The switch-role server action, passed down by the layout. Shared components
   * never import from `src/app` (pnpm check:architecture) — the route that owns
   * the surface hands its actions in as props.
   */
  switchRole: (roleId: string, shopSlug: string) => Promise<void>;
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
  switchRole,
}: DemoBannerProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [switchingTo, setSwitchingTo] = useState<string | null>(null);
  const [switchFailed, setSwitchFailed] = useState(false);

  const activeInfo = roles.find((r) => r.id === currentRole);

  const handleRoleSwitch = (roleId: string) => {
    if (roleId === currentRole) return;
    setSwitchingTo(roleId);
    setSwitchFailed(false);
    startTransition(async () => {
      try {
        await switchRole(roleId, shopSlug);
      } catch (err) {
        console.error("Failed to switch demo role:", err);
        // The panel has already closed by now — say so in the banner itself,
        // not only in a console nobody on a demo is watching.
        setSwitchFailed(true);
      } finally {
        setSwitchingTo(null);
      }
    });
    setIsExpanded(false);
  };

  return (
    <div className="border-b border-accent/40 bg-accent/5 transition-all duration-300 print:hidden">
      <div className="mx-auto w-full max-w-4xl px-4 py-3 sm:px-6">
        {/*
         * One wrapping row, not a phone-only column. The column put "Switch
         * role" on a line of its own pinned hard right (`self-end`), so on a
         * phone the ribbon read as a stray button floating in a band of empty
         * space, disconnected from the sentence it belongs to. Wrapping keeps
         * it on the same line whenever there is room and drops it directly
         * under the text — left-aligned with everything else — when there
         * isn't. `justify-between` still pushes it to the far edge on the wide
         * single-line layout, which is where it has always sat.
         */}
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
          <div className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1">
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

          <button
            type="button"
            onClick={() => setIsExpanded(!isExpanded)}
            className={buttonClass({
              variant: "secondary",
              size: "sm",
              className: "shrink-0",
            })}
          >
            {copy.switchRole} {isExpanded ? "▲" : "▼"}
          </button>
        </div>

        {switchFailed ? (
          <p role="alert" className="mt-2 text-sm font-medium text-danger">
            {copy.switchFailed}
          </p>
        ) : null}

        {isMintedDemo ? (
          <div className="mt-2 text-xs text-muted">
            <p>{copy.sharedWarning}</p>
          </div>
        ) : null}

        {/* Expandable Role Switched Panel */}
        {isExpanded ? (
          <div className="mt-4 border-t border-border/60 pt-4">
            {/* **The way back in, one tap off the first frame.**
                This credential pair used to sit in the banner itself, on every
                page of the demo, from the first millisecond — so the first
                sentence a prospective buyer read inside the product was
                recovery instructions for a failure that had not happened, in
                monospace, about a session expiring (issue #806). It is also
                the scaffolding principle 4 says never to surface.
                It cannot be shown *when* the session expires, which would be
                the ideal: this banner renders only for a signed-in demo
                visitor, so by the time the session is gone the reader is at
                /sign-in and this component is not on the page. So it lives
                here — behind the one control the banner already has, where
                somebody looking for a way back will look. */}
            {currentEmail && demoPassword ? (
              <p className="mb-4 text-xs text-muted">
                {copy.sessionExpired}{" "}
                <Link href="/sign-in" className="font-medium text-primary hover:underline">
                  /sign-in
                </Link>{" "}
                {copy.withCredentials}{" "}
                {/* A demo address is one long unbroken token; without an
                    explicit break it pushed the whole banner wider than the
                    phone and took the page's horizontal scroll with it. */}
                <span className="font-mono break-all">{currentEmail}</span> /{" "}
                <span className="font-mono break-all">{demoPassword}</span>.
              </p>
            ) : null}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
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
                      aria-label={isActive ? undefined : role.switchAriaLabel}
                      onClick={() => handleRoleSwitch(role.id)}
                      className={buttonClass({
                        variant: isActive ? "secondary" : "primary",
                        size: "sm",
                        className: "mt-4 w-full",
                      })}
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
