import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { EmptyState } from "@/components/EmptyState";
import { FlashParams } from "@/components/FlashParams";
import { ShopPageHeader } from "@/components/ShopPageHeader";
import { StaffNoticeBanner } from "@/components/StaffNoticeBanner";
import { SubmitButton } from "@/components/SubmitButton";
import { UndoToast } from "@/components/UndoToast";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { controlClass, Field, FieldActions, FieldGrid } from "@/components/ui/form";
import { canPersonManageStaffAccounts } from "@/db/authz";
import { getDb } from "@/db/client";
import { getShopById } from "@/db/shops";
import { listShopStaff, type StaffMember } from "@/db/staff-accounts";
import { requestLocale } from "@/i18n/request";
import { type StaffTranslator, staffTranslator } from "@/i18n/staff-messages";
import { type Role, STAFF_ROLES } from "@/lib/authz";
import { requireStaffSession } from "@/lib/session";
import { noticeFromParam } from "@/lib/staff-notices";
import {
  inviteStaffAction,
  removeStaffAction,
  resendInviteAction,
  restoreStaffAction,
  saveAllStaffRolesAction,
  setStaffStatusAction,
} from "./actions";

// TODO: Cache Components adoption. Refactor this route so this opt-out can be removed.
// See: https://nextjs.org/docs/app/guides/migrating-to-cache-components
export const instant = false;

const ROLES_FORM_ID = "team-roles-form";

export const metadata: Metadata = { title: "Team — DiveDay" };

/**
 * Built inside the request, not at module scope, so the notice text tracks
 * the negotiated locale rather than freezing to whichever locale first
 * imported this file.
 */
function noticeMessages(
  t: StaffTranslator,
): Record<string, { tone: "success" | "danger" | "warning"; text: string }> {
  return {
    invited: { tone: "success", text: t("settings.team.notice.invited") },
    invite_resent: { tone: "success", text: t("settings.team.notice.inviteResent") },
    changes_saved: { tone: "success", text: t("settings.team.notice.changesSaved") },
    reactivated: { tone: "success", text: t("settings.team.notice.reactivated") },
    disabled: { tone: "success", text: t("settings.team.notice.disabled") },
    removed: { tone: "success", text: t("settings.team.notice.removed") },
    restored: { tone: "success", text: t("settings.team.notice.restored") },
    restore_failed: { tone: "danger", text: t("settings.team.notice.restoreFailed") },
    invite_invalid: { tone: "danger", text: t("settings.team.notice.inviteInvalid") },
    roles_invalid: { tone: "danger", text: t("settings.team.notice.rolesInvalid") },
    invite_already_on_team: {
      tone: "danger",
      text: t("settings.team.notice.inviteAlreadyOnTeam"),
    },
    invite_email_taken: { tone: "danger", text: t("settings.team.notice.inviteEmailTaken") },
    last_owner: { tone: "danger", text: t("settings.team.notice.lastOwner") },
    not_found: { tone: "danger", text: t("settings.team.notice.notFound") },
    not_authorized: { tone: "danger", text: t("settings.team.notice.notAuthorized") },
  };
}

function statusBadge(
  t: StaffTranslator,
): Record<StaffMember["accountStatus"], { label: string; tone: BadgeTone }> {
  return {
    invited: { label: t("settings.team.statusBadge.invited"), tone: "warning" },
    active: { label: t("settings.team.statusBadge.active"), tone: "success" },
    disabled: { label: t("settings.team.statusBadge.disabled"), tone: "neutral" },
  };
}

/**
 * Display labels for every staff role, translated for this page only.
 * `STAFF_ROLE_LABELS` in `src/lib/authz.ts` also holds English role labels
 * (used by the invite email in `./actions.ts`) — out of this batch's scope,
 * flagged in the extraction report rather than changed here.
 */
function roleLabels(t: StaffTranslator): Record<Role, string> {
  return {
    owner: t("settings.team.roleLabels.owner"),
    manager: t("settings.team.roleLabels.manager"),
    instructor: t("settings.team.roleLabels.instructor"),
    divemaster: t("settings.team.roleLabels.divemaster"),
    captain: t("settings.team.roleLabels.captain"),
    crew: t("settings.team.roleLabels.crew"),
    diver: t("settings.team.roleLabels.diver"),
  };
}

function RoleCheckboxes({
  name,
  defaultRoles,
  formId,
  t,
}: {
  name: string;
  defaultRoles: readonly string[];
  /** Associates each checkbox with a form elsewhere in the page (HTML `form`
   * attribute) instead of nesting — lets a per-member Disable/Delete form
   * sit right below without ever nesting one <form> inside another. */
  formId?: string;
  t: StaffTranslator;
}) {
  const labels = roleLabels(t);
  return (
    <fieldset className="grid grid-cols-2 gap-2 sm:grid-cols-3">
      <legend className="sr-only">{t("settings.team.rolesLegend")}</legend>
      {STAFF_ROLES.map((role) => (
        <label
          key={role}
          className="flex min-h-11 items-center gap-2 rounded-lg border border-border px-3 text-sm"
        >
          <input
            name={`${name}_${role}`}
            type="checkbox"
            defaultChecked={defaultRoles.includes(role)}
            form={formId}
            className="size-4 accent-primary"
          />
          {labels[role]}
        </label>
      ))}
    </fieldset>
  );
}

function StaffRow({ member, t }: { member: StaffMember; t: StaffTranslator }) {
  const status = statusBadge(t)[member.accountStatus];
  const isDisabled = member.accountStatus === "disabled";
  return (
    <li className="rounded-lg border border-border bg-surface p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="font-medium">{member.fullName}</p>
          <p className="text-sm text-muted">{member.email}</p>
        </div>
        <Badge tone={status.tone}>{status.label}</Badge>
      </div>

      <div className="mt-4">
        <RoleCheckboxes
          name={`role_${member.personId}`}
          defaultRoles={member.roles}
          formId={ROLES_FORM_ID}
          t={t}
        />
      </div>

      <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          {member.accountStatus === "invited" ? (
            <form action={resendInviteAction}>
              <input type="hidden" name="userAccountId" value={member.userAccountId} />
              <SubmitButton
                pendingLabel={t("settings.team.staffRow.sending")}
                className={buttonClass({
                  variant: "secondary",
                  size: "sm",
                  className: "w-full text-foreground sm:w-auto",
                })}
              >
                {t("settings.team.staffRow.resendInvite")}
              </SubmitButton>
            </form>
          ) : null}
        </div>
        {member.accountStatus !== "invited" ? (
          <div className="flex gap-2">
            <form action={setStaffStatusAction}>
              <input type="hidden" name="personId" value={member.personId} />
              <input type="hidden" name="userAccountId" value={member.userAccountId} />
              <input type="hidden" name="status" value={isDisabled ? "active" : "disabled"} />
              <SubmitButton
                pendingLabel={
                  isDisabled
                    ? t("settings.team.staffRow.enabling")
                    : t("settings.team.staffRow.disabling")
                }
                ariaLabel={
                  isDisabled
                    ? t("settings.team.staffRow.enableAriaLabel", { name: member.fullName })
                    : t("settings.team.staffRow.disableAriaLabel", { name: member.fullName })
                }
                className={buttonClass({ variant: "secondary", size: "sm" })}
              >
                {isDisabled
                  ? t("settings.team.staffRow.enable")
                  : t("settings.team.staffRow.disable")}
              </SubmitButton>
            </form>
            {isDisabled ? (
              <form action={removeStaffAction}>
                <input type="hidden" name="personId" value={member.personId} />
                <input type="hidden" name="userAccountId" value={member.userAccountId} />
                <input type="hidden" name="fullName" value={member.fullName} />
                {/* Land-then-undo, not a blocking confirm: stripping roles and
                    disabling sign-in is a purely reversible edit (principle 7,
                    docs/design/principles.md) — the toast on the next render
                    carries what's needed to hand back to setStaffRoles. */}
                <SubmitButton
                  pendingLabel={t("settings.team.staffRow.deleting")}
                  ariaLabel={t("settings.team.staffRow.deleteAriaLabel", {
                    name: member.fullName,
                  })}
                  className={buttonClass({ variant: "danger", size: "sm" })}
                >
                  {t("settings.team.staffRow.delete")}
                </SubmitButton>
              </form>
            ) : null}
          </div>
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
  searchParams: Promise<{
    notice?: string;
    undoPersonId?: string;
    undoUserAccountId?: string;
    undoRoles?: string;
    undoName?: string;
  }>;
}) {
  const session = await requireStaffSession();
  const { shopSlug } = await params;
  const { notice, undoPersonId, undoUserAccountId, undoRoles, undoName } = await searchParams;
  const db = await getDb();

  const canManage = await canPersonManageStaffAccounts(
    db,
    session.user.shopId,
    session.user.personId,
  );
  // Settings, not Today: Team is a Settings sub-page, and the nearest parent
  // surface is where a refusal explains itself best (the same landing the
  // promos and WhatsApp gates already use). A code the destination handles,
  // never a silent teleport (task 82).
  if (!canManage) redirect(`/shop/${shopSlug}/settings?notice=team_not_authorized`);

  const staff = await listShopStaff(db, session.user.shopId);
  const shop = await getShopById(db, session.user.shopId);
  const t = staffTranslator(await requestLocale(shop?.defaultLocale));
  const banner = noticeFromParam(notice, noticeMessages(t));

  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <FlashParams
        params={["notice", "undoPersonId", "undoUserAccountId", "undoRoles", "undoName"]}
      />
      <ShopPageHeader
        eyebrow={t("settings.team.eyebrow")}
        title={t("settings.team.title")}
        description={t("settings.team.description")}
        actions={
          <Link
            href={`/shop/${shopSlug}/settings`}
            className={buttonClass({ variant: "secondary", className: "text-foreground" })}
          >
            {t("settings.main.backToSettings")}
          </Link>
        }
      />

      {notice === "removed" && undoPersonId && undoUserAccountId && undoRoles ? (
        <UndoToast
          message={t("settings.team.staffRow.removedToast", { name: undoName ?? "" })}
          action={restoreStaffAction}
          fields={{
            personId: undoPersonId,
            userAccountId: undoUserAccountId,
            roles: undoRoles,
          }}
          pendingLabel={t("shared.undoToast.pendingLabel")}
          undoLabel={t("shared.undoToast.undo")}
        />
      ) : banner ? (
        <StaffNoticeBanner tone={banner.tone}>{banner.text}</StaffNoticeBanner>
      ) : null}

      {/* The anchor the roster's empty state jumps to. */}
      <section id="invite" className="scroll-mt-24 rounded-lg border border-border bg-surface p-6">
        <h2 className="font-medium">{t("settings.team.invite.heading")}</h2>
        <p className="mt-1 text-sm text-muted">{t("settings.team.invite.description")}</p>
        <FieldGrid as="form" action={inviteStaffAction} columns={2} className="mt-4">
          <Field label={t("settings.team.invite.fullNameLabel")}>
            <input
              name="fullName"
              type="text"
              required
              maxLength={120}
              autoComplete="name"
              className={controlClass}
            />
          </Field>
          <Field label={t("settings.team.invite.emailLabel")}>
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
            <RoleCheckboxes name="role" defaultRoles={[]} t={t} />
          </div>
          <FieldActions>
            <SubmitButton
              pendingLabel={t("settings.team.invite.submitting")}
              className={buttonClass()}
            >
              {t("settings.team.invite.submit")}
            </SubmitButton>
          </FieldActions>
        </FieldGrid>
      </section>

      <section className="mt-6">
        <h2 className="font-medium">{t("settings.team.current.heading")}</h2>
        <p className="mt-1 text-sm text-muted">{t("settings.team.current.description")}</p>
        {staff.length === 0 ? (
          <EmptyState className="mt-2">
            <p className="mx-auto max-w-md text-sm text-muted">
              {t("settings.team.current.empty")}
            </p>
            {/* Reaching this page at all took the manage-staff gate, so anyone
                reading this may send the invite — no second check needed. */}
            <a href="#invite" className={buttonClass({ size: "sm", className: "mt-4" })}>
              {t("settings.team.current.emptyAction")}
            </a>
          </EmptyState>
        ) : (
          <>
            <ul className="mt-3 flex flex-col gap-3">
              {staff.map((member) => (
                <StaffRow key={member.personId} member={member} t={t} />
              ))}
            </ul>
            {/* Every card's role checkboxes are associated to this form via the
                HTML `form` attribute (see RoleCheckboxes), not DOM nesting — so
                this can sit at the bottom of the page while each row keeps its
                own separate, immediate Enable/Disable/Delete forms. */}
            <form
              id={ROLES_FORM_ID}
              action={saveAllStaffRolesAction}
              className="mt-4 flex justify-end"
            >
              <SubmitButton
                pendingLabel={t("settings.team.current.saving")}
                className={buttonClass({ variant: "primary" })}
              >
                {t("settings.team.current.save")}
              </SubmitButton>
            </form>
          </>
        )}
      </section>
    </main>
  );
}
