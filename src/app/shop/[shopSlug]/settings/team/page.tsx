import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { FlashParams } from "@/components/FlashParams";
import { ShopNotice, ShopPageHeader } from "@/components/ShopPageHeader";
import { SubmitButton } from "@/components/SubmitButton";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { controlClass, Field, FieldActions, FieldGrid } from "@/components/ui/form";
import { canPersonManageStaffAccounts } from "@/db/authz";
import { getDb } from "@/db/client";
import { listShopStaff, type StaffMember } from "@/db/staff-accounts";
import { STAFF_ROLE_LABELS, STAFF_ROLES } from "@/lib/authz";
import { requireStaffSession } from "@/lib/session";
import {
  inviteStaffAction,
  removeStaffAction,
  resendInviteAction,
  saveStaffChangesAction,
} from "./actions";

export const metadata: Metadata = { title: "Team — DiveDay" };

const NOTICE_MESSAGES: Record<string, { tone: "success" | "danger" | "warning"; text: string }> = {
  invited: { tone: "success", text: "Invite sent." },
  invite_resent: { tone: "success", text: "Invite resent." },
  roles_saved: { tone: "success", text: "Roles saved." },
  changes_saved: { tone: "success", text: "Team changes saved." },
  reactivated: { tone: "success", text: "Account re-enabled." },
  disabled: { tone: "success", text: "Account disabled — they can no longer sign in." },
  removed: { tone: "success", text: "Removed from the team." },
  invite_invalid: {
    tone: "danger",
    text: "Enter a name, a valid email, and check at least one role.",
  },
  roles_invalid: { tone: "danger", text: "Check at least one role before saving." },
  invite_already_on_team: { tone: "danger", text: "That person already has an account here." },
  invite_email_taken: {
    tone: "danger",
    text: "That email is already registered to a different shop.",
  },
  last_owner: {
    tone: "danger",
    text: "Can't do that — the shop needs at least one owner. Make someone else an owner first.",
  },
  not_found: { tone: "danger", text: "That person isn't on this shop's team." },
  not_authorized: {
    tone: "danger",
    text: "Team management is limited to owners and managers.",
  },
};

const STATUS_BADGE: Record<StaffMember["accountStatus"], { label: string; tone: BadgeTone }> = {
  invited: { label: "Invited", tone: "warning" },
  active: { label: "Active", tone: "success" },
  disabled: { label: "Disabled", tone: "neutral" },
};

function RoleCheckboxes({ name, defaultRoles }: { name: string; defaultRoles: readonly string[] }) {
  return (
    <fieldset className="grid grid-cols-2 gap-2 sm:grid-cols-3">
      <legend className="sr-only">Roles</legend>
      {STAFF_ROLES.map((role) => (
        <label
          key={role}
          className="flex min-h-11 items-center gap-2 rounded-lg border border-border px-3 text-sm"
        >
          <input
            name={`${name}_${role}`}
            type="checkbox"
            defaultChecked={defaultRoles.includes(role)}
            className="size-4 accent-primary"
          />
          {STAFF_ROLE_LABELS[role]}
        </label>
      ))}
    </fieldset>
  );
}

function StaffRow({ member }: { member: StaffMember }) {
  const status = STATUS_BADGE[member.accountStatus];
  return (
    <li className="rounded-lg border border-border bg-surface p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="font-medium">{member.fullName}</p>
          <p className="text-sm text-muted">{member.email}</p>
        </div>
        <Badge tone={status.tone}>{status.label}</Badge>
      </div>

      <form action={saveStaffChangesAction} className="mt-4">
        <input type="hidden" name="personId" value={member.personId} />
        <input type="hidden" name="userAccountId" value={member.userAccountId} />
        <RoleCheckboxes name="role" defaultRoles={member.roles} />
        {member.accountStatus !== "invited" ? (
          <label className="mt-4 flex min-h-11 items-center gap-3 rounded-lg border border-border px-3 text-sm">
            <input
              name="status"
              type="checkbox"
              value="disabled"
              defaultChecked={member.accountStatus === "disabled"}
              className="size-4 accent-primary"
            />
            Disable sign-in for this person
          </label>
        ) : (
          <input type="hidden" name="status" value="invited" />
        )}
        <SubmitButton
          pendingLabel="Saving…"
          className={buttonClass({ variant: "primary", className: "mt-4" })}
        >
          Save changes
        </SubmitButton>
      </form>

      <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          {member.accountStatus === "invited" ? (
            <form action={resendInviteAction}>
              <input type="hidden" name="userAccountId" value={member.userAccountId} />
              <SubmitButton
                pendingLabel="Sending…"
                className={buttonClass({
                  variant: "secondary",
                  size: "sm",
                  className: "w-full text-foreground sm:w-auto",
                })}
              >
                Resend invite
              </SubmitButton>
            </form>
          ) : (
            <span className="text-sm text-muted">
              {member.accountStatus === "active" ? "Sign-in enabled" : "Sign-in disabled"}
            </span>
          )}
        </div>
        {member.accountStatus === "disabled" ? (
          <form action={removeStaffAction}>
            <input type="hidden" name="personId" value={member.personId} />
            <input type="hidden" name="userAccountId" value={member.userAccountId} />
            <SubmitButton
              pendingLabel="Removing…"
              className={buttonClass({ variant: "danger", size: "sm" })}
            >
              Remove from team
            </SubmitButton>
          </form>
        ) : null}
      </div>
    </li>
  );
}

export default async function TeamSettingsPage({
  params,
  searchParams,
}: {
  params: Promise<{ shopSlug: string }>;
  searchParams: Promise<{ notice?: string }>;
}) {
  const session = await requireStaffSession();
  const { shopSlug } = await params;
  const { notice } = await searchParams;
  const db = await getDb();

  const canManage = await canPersonManageStaffAccounts(
    db,
    session.user.shopId,
    session.user.personId,
  );
  if (!canManage) redirect(`/shop/${shopSlug}`);

  const staff = await listShopStaff(db, session.user.shopId);
  const banner = notice ? NOTICE_MESSAGES[notice] : undefined;

  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <FlashParams params={["notice"]} />
      <ShopPageHeader
        eyebrow="Settings"
        title="Team"
        description="Invite staff, set what each person can do, and manage who still has access."
      />

      {banner ? (
        <div className="mb-6">
          <ShopNotice tone={banner.tone} role={banner.tone === "danger" ? "alert" : "status"}>
            {banner.text}
          </ShopNotice>
        </div>
      ) : null}

      <section className="rounded-lg border border-border bg-surface p-6">
        <h2 className="font-medium">Invite someone</h2>
        <p className="mt-1 text-sm text-muted">
          They'll get an email to set their own password. If they're already a diver at your shop,
          inviting them by the same email adds staff access to their existing record instead of
          creating a second one.
        </p>
        <FieldGrid as="form" action={inviteStaffAction} columns={2} className="mt-4">
          <Field label="Full name">
            <input
              name="fullName"
              type="text"
              required
              maxLength={120}
              autoComplete="name"
              className={controlClass}
            />
          </Field>
          <Field label="Email">
            <input
              name="email"
              type="email"
              required
              maxLength={150}
              autoComplete="email"
              className={controlClass}
            />
          </Field>
          <div className="sm:col-span-2">
            <RoleCheckboxes name="role" defaultRoles={[]} />
          </div>
          <FieldActions>
            <SubmitButton pendingLabel="Sending…" className={buttonClass()}>
              Send invite
            </SubmitButton>
          </FieldActions>
        </FieldGrid>
      </section>

      <section className="mt-6">
        <h2 className="font-medium">Current team</h2>
        {staff.length === 0 ? (
          <p className="mt-2 text-sm text-muted">No staff invited yet.</p>
        ) : (
          <ul className="mt-3 flex flex-col gap-3">
            {staff.map((member) => (
              <StaffRow key={member.personId} member={member} />
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
