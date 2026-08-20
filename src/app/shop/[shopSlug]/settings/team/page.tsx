import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { EmptyState } from "@/components/EmptyState";
import { FlashParams } from "@/components/FlashParams";
import { ShopPageHeader } from "@/components/ShopPageHeader";
import { StaffNoticeBanner } from "@/components/StaffNoticeBanner";
import { SubmitButton } from "@/components/SubmitButton";
import { UndoToast } from "@/components/UndoToast";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { SectionCard } from "@/components/ui/card";
import { DisclosureCaret } from "@/components/ui/DisclosureCaret";
import { FieldErrorFocus } from "@/components/ui/FieldErrorFocus";
import { controlClass, Field, FieldActions, FieldGrid, FormStatus } from "@/components/ui/form";
import { canPersonManageStaffAccounts } from "@/db/authz";
import { getDb } from "@/db/client";
import { getShopById } from "@/db/shops";
import { listShopStaff, type StaffMember } from "@/db/staff-accounts";
import { requestLocale } from "@/i18n/request";
import { type StaffTranslator, staffTranslator } from "@/i18n/staff-messages";
import { type Role, STAFF_ROLES } from "@/lib/authz";
import { requireStaffSession } from "@/lib/session";
import { noticeFromParam, noticeUrl, shopPath } from "@/lib/staff-notices";
import {
  inviteStaffAction,
  removeStaffAction,
  resendInviteAction,
  restoreStaffAction,
  saveAllStaffRolesAction,
  saveStaffEmergencyContactAction,
  setStaffStatusAction,
} from "./actions";

// `instant = true` asserts that navigating *into* this page paints
// immediately. It is not a claim that the route has a static shell: the staff
// shell layout declares `instant = false` (read its comment for why), so a
// cold, direct visit still blocks on the session and the shop row. What this
// validates is the navigation staff actually make all day — arriving from
// another `/shop` page, where that shell is already mounted and this
// segment's `loading.tsx` is what paints. See ADR 20260804-instant-navigation.
export const instant = true;

const ROLES_FORM_ID = "team-roles-form";

export const metadata: Metadata = { title: "Team — DiveDay" };

/** Refusals about the address typed into the invite form's Email box. */
const INVITE_EMAIL_NOTICES = new Set([
  "invite-already-on-team",
  "invite-email-taken",
  "invite-email-reserved",
]);

/** The rest of what the invite form itself can say, refusals and confirmation alike. */
const INVITE_FORM_NOTICES = new Set(["invited", "invite-invalid"]);
/** Outcomes of one staff card's emergency-contact form, shown on that card. */
const CONTACT_FORM_NOTICES = new Set(["contact-saved", "half-filled"]);

/** One resolved `?notice=`: the tone it carries and the words for it. */
type NoticeMessage = { tone: "success" | "danger" | "warning"; text: string };

/**
 * Built inside the request, not at module scope, so the notice text tracks
 * the negotiated locale rather than freezing to whichever locale first
 * imported this file.
 */
function noticeMessages(t: StaffTranslator): Record<string, NoticeMessage> {
  return {
    invited: { tone: "success", text: t("settings.team.notice.invited") },
    "invite-resent": { tone: "success", text: t("settings.team.notice.inviteResent") },
    "changes-saved": { tone: "success", text: t("settings.team.notice.changesSaved") },
    reactivated: { tone: "success", text: t("settings.team.notice.reactivated") },
    disabled: { tone: "success", text: t("settings.team.notice.disabled") },
    removed: { tone: "success", text: t("settings.team.notice.removed") },
    restored: { tone: "success", text: t("settings.team.notice.restored") },
    "restore-failed": { tone: "danger", text: t("settings.team.notice.restoreFailed") },
    "invite-invalid": { tone: "danger", text: t("settings.team.notice.inviteInvalid") },
    "roles-invalid": { tone: "danger", text: t("settings.team.notice.rolesInvalid") },
    "invite-already-on-team": {
      tone: "danger",
      text: t("settings.team.notice.inviteAlreadyOnTeam"),
    },
    "invite-email-taken": { tone: "danger", text: t("settings.team.notice.inviteEmailTaken") },
    "invite-email-reserved": {
      tone: "danger",
      text: t("settings.team.notice.inviteEmailReserved"),
    },
    "contact-saved": { tone: "success", text: t("settings.team.notice.contactSaved") },
    "half-filled": { tone: "danger", text: t("settings.team.notice.contactHalfFilled") },
    "last-owner": { tone: "danger", text: t("settings.team.notice.lastOwner") },
    "not-found": { tone: "danger", text: t("settings.team.notice.notFound") },
    "not-authorized": { tone: "danger", text: t("settings.team.notice.notAuthorized") },
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

function StaffRow({
  member,
  contactStatus,
  t,
}: {
  member: StaffMember;
  /** This card's own emergency-contact outcome, or nothing. */
  contactStatus: NoticeMessage | undefined;
  t: StaffTranslator;
}) {
  const status = statusBadge(t)[member.accountStatus];
  const isDisabled = member.accountStatus === "disabled";
  return (
    // A person's row on the roster is the same card as everything else on the
    // page — one radius, one elevation — so the list reads as a list of cards
    // rather than a second, flatter kind of box.
    <SectionCard as="li" id={`staff-${member.personId}`}>
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

      {/* Who to call for this person, and the one place a shop can say so.
          Behind a disclosure because it is the rare edit — a contact is typed
          once and then read off a printed manifest for years (principle 8) —
          and because a roster of eleven people with four open boxes each is a
          form, not a team page.

          It prints on the boat manifest, which is the whole reason it exists:
          the sheet a coastguard reads answered "who do we call?" for every
          paying diver and for neither of the two staff most reliably in the
          water (dive-domain review 20260810). */}
      <details className="group/contact mt-4">
        <summary className="flex min-h-11 w-fit cursor-pointer list-none items-center gap-2 text-sm text-muted select-none hover:text-primary [&::-webkit-details-marker]:hidden">
          <DisclosureCaret className="group-open/contact:rotate-90" />
          <span className="hover:underline">
            {member.emergencyContactName && member.emergencyContactPhone
              ? t("settings.team.emergencyContact.summaryOnFile", {
                  name: member.emergencyContactName,
                })
              : t("settings.team.emergencyContact.summaryEmpty")}
          </span>
        </summary>
        <FieldGrid as="form" action={saveStaffEmergencyContactAction} columns={2} className="mt-3">
          <input type="hidden" name="personId" value={member.personId} />
          <Field label={t("settings.team.emergencyContact.nameLabel")}>
            <input
              name="emergencyContactName"
              defaultValue={member.emergencyContactName ?? ""}
              autoComplete="off"
              className={controlClass}
            />
          </Field>
          <Field label={t("settings.team.emergencyContact.phoneLabel")}>
            <input
              name="emergencyContactPhone"
              type="tel"
              defaultValue={member.emergencyContactPhone ?? ""}
              autoComplete="off"
              className={controlClass}
            />
          </Field>
          <FieldActions>
            <FormStatus tone={contactStatus?.tone}>{contactStatus?.text}</FormStatus>
            <SubmitButton
              pendingLabel={t("settings.team.emergencyContact.saving")}
              className={buttonClass({ variant: "secondary", size: "sm" })}
            >
              {t("settings.team.emergencyContact.save")}
            </SubmitButton>
          </FieldActions>
        </FieldGrid>
      </details>

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
                  className: "w-full sm:w-auto",
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
                    carries what's needed to hand back to setStaffRoles.

                    The button says "Delete" and the deletion is soft, which is
                    the rule everywhere (ADR 20260820-every-delete-is-soft).
                    `removeStaffMember` strips staff roles, disables the login,
                    and revokes the person's push subscriptions — the `people`
                    row, and every booking, manifest and signature attached to
                    it, deliberately survives. The reader is never told that:
                    reversibility is a promise we keep, not a concept they hold,
                    and this page's one irreversible act is erasure, which says
                    so itself. */}
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
    </SectionCard>
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
    contactFor?: string;
  }>;
}) {
  const session = await requireStaffSession();
  const { shopSlug } = await params;
  const { notice, undoPersonId, undoUserAccountId, undoRoles, undoName, contactFor } =
    await searchParams;
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
  if (!canManage) redirect(noticeUrl(shopPath(shopSlug), "team-not-authorized"));

  const staff = await listShopStaff(db, session.user.shopId);
  const shop = await getShopById(db, session.user.shopId);
  const t = staffTranslator(await requestLocale(shop?.defaultLocale));
  const banner = noticeFromParam(notice, noticeMessages(t));
  // An invitation's outcome belongs on the invitation form — and the three
  // refusals that are really about one address belong on that address box.
  // Everything else here is about the roster below (a role change, a member
  // disabled) and keeps the page banner.
  const inviteEmailError =
    notice && INVITE_EMAIL_NOTICES.has(notice) ? (banner?.text ?? undefined) : undefined;
  const inviteStatus =
    !inviteEmailError && notice && INVITE_FORM_NOTICES.has(notice) ? banner : undefined;
  // An emergency contact's outcome belongs on the card whose contact it is —
  // `contactFor` names that card, so a "name without a number" refusal is beside
  // the two boxes that caused it and not above a roster of eleven people.
  const contactStatus =
    notice && CONTACT_FORM_NOTICES.has(notice) && contactFor ? banner : undefined;
  const pageBanner = inviteEmailError || inviteStatus || contactStatus ? undefined : banner;

  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <FlashParams
        params={[
          "notice",
          "undoPersonId",
          "undoUserAccountId",
          "undoRoles",
          "undoName",
          "contactFor",
        ]}
      />
      <ShopPageHeader
        eyebrow={t("settings.team.eyebrow")}
        eyebrowHref={`/shop/${shopSlug}/settings`}
        title={t("settings.team.title")}
        description={t("settings.team.description")}
      />

      {notice === "removed" && undoPersonId && undoUserAccountId && undoRoles ? (
        <UndoToast
          message={t("settings.team.staffRow.deletedToast", { name: undoName ?? "" })}
          action={restoreStaffAction}
          fields={{
            personId: undoPersonId,
            userAccountId: undoUserAccountId,
            roles: undoRoles,
          }}
          pendingLabel={t("shared.undoToast.pendingLabel")}
          undoLabel={t("shared.undoToast.undo")}
        />
      ) : pageBanner ? (
        <StaffNoticeBanner tone={pageBanner.tone}>{pageBanner.text}</StaffNoticeBanner>
      ) : null}

      {/* Section rhythm belongs to the page, not to each section: one
          `space-y-10` here, and no `mt-*` on any card
          (docs/design/forms-and-controls.md). */}
      <div className="space-y-10">
        {/* The anchor the roster's empty state jumps to. */}
        <SectionCard
          id="invite"
          padding="lg"
          className="scroll-mt-24"
          title={t("settings.team.invite.heading")}
          description={t("settings.team.invite.description")}
        >
          <FieldGrid as="form" action={inviteStaffAction} columns={2}>
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
            <Field label={t("settings.team.invite.emailLabel")} error={inviteEmailError}>
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
              <FormStatus tone={inviteStatus?.tone}>{inviteStatus?.text}</FormStatus>
            </FieldActions>
            <FieldErrorFocus key={notice} scope="invite" />
          </FieldGrid>
        </SectionCard>

        <section>
          {/* Not a card — a heading over a list of them. It wears the same
              heading spelling `SectionCard` uses so the two sections on this
              page read at one level. */}
          <h2 className="text-lg font-semibold">{t("settings.team.current.heading")}</h2>
          <p className="mt-1 max-w-2xl text-sm text-muted">
            {t("settings.team.current.description")}
          </p>
          {staff.length === 0 ? (
            <EmptyState className="mt-4">
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
              <ul className="mt-4 flex flex-col gap-3">
                {staff.map((member) => (
                  <StaffRow
                    key={member.personId}
                    member={member}
                    contactStatus={contactFor === member.personId ? contactStatus : undefined}
                    t={t}
                  />
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
      </div>
    </main>
  );
}
