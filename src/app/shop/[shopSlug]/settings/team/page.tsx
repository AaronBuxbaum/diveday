import type { Metadata } from "next";
import { EmptyState } from "@/components/EmptyState";
import { FlashParams } from "@/components/FlashParams";
import { ShopPageHeader } from "@/components/ShopPageHeader";
import { StaffNoticeBanner } from "@/components/StaffNoticeBanner";
import { SubmitButton } from "@/components/SubmitButton";
import { UndoToast } from "@/components/UndoToast";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { SectionCard } from "@/components/ui/card";
import { CompactDisclosureRow } from "@/components/ui/disclosure";
import { FieldErrorFocus } from "@/components/ui/FieldErrorFocus";
import { controlClass, Field, FieldActions, FieldGrid, FormStatus } from "@/components/ui/form";
import { InsetGroup } from "@/components/ui/ledger";
import { canPersonManageStaffAccounts } from "@/db/authz";
import { listShopStaff, type StaffMember } from "@/db/staff-accounts";
import { languageNameIn } from "@/i18n/language-labels";
import { requestLocale } from "@/i18n/request";
import { type StaffTranslator, staffTranslator } from "@/i18n/staff-messages";
import { type Role, STAFF_ROLES } from "@/lib/authz";
import { cachedListFormat } from "@/lib/intl-cache";
import { requireShopSurface } from "@/lib/session";
import { COMMON_SPOKEN_LANGUAGES } from "@/lib/spoken-languages";
import { type FormNotice, noticeForForm, noticeFromParam } from "@/lib/staff-notices";
import { StaffRolesDisclosure } from "./_components/StaffRolesDisclosure";
import {
  inviteStaffAction,
  removeStaffAction,
  resendInviteAction,
  restoreStaffAction,
  saveStaffEmergencyContactAction,
  saveStaffLanguagesAction,
  saveStaffRolesAction,
  setStaffStatusAction,
} from "./actions";
import { TEAM_FORMS, teamNoticeForm, teamNoticeOnRoster } from "./notices";

// `instant = true` asserts that navigating *into* this page paints
// immediately. It is not a claim that the route has a static shell: the staff
// shell layout declares `instant = false` (read its comment for why), so a
// cold, direct visit still blocks on the session and the shop row. What this
// validates is the navigation staff actually make all day — arriving from
// another `/shop` page, where that shell is already mounted and this
// segment's `loading.tsx` is what paints. See ADR 20260804-instant-navigation.
export const instant = true;

export const metadata: Metadata = { title: "Team — DiveDay" };

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
    "roles-conflict": { tone: "danger", text: t("settings.team.notice.rolesConflict") },
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
    "languages-saved": { tone: "success", text: t("settings.team.notice.languagesSaved") },
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

/**
 * The invite form's role picker. A roster row's is `StaffRolesDisclosure` —
 * the per-row disclosure that saves on close (ADR 20260827-the-shops-shelves,
 * slice 9h). This one stays a plain fieldset because it is one part of a form
 * with its own Send invite: there is nothing to close, and nothing to save yet.
 */
function RoleCheckboxes({
  name,
  defaultRoles,
  t,
}: {
  name: string;
  defaultRoles: readonly string[];
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
            className="size-4 accent-primary"
          />
          {labels[role]}
        </label>
      ))}
    </fieldset>
  );
}

/**
 * One staff member's spoken languages (issue #708) — a checkbox per language
 * DiveDay can render, each labelled in the *reader's* own language
 * (`languageNameIn`) so the staffer filling this in recognises the option,
 * unlike the diver-facing badge below which uses each language's endonym.
 */
function LanguageCheckboxes({
  defaultLanguages,
  locale,
  t,
}: {
  defaultLanguages: readonly string[];
  locale: string;
  t: StaffTranslator;
}) {
  return (
    <fieldset className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      <legend className="sr-only">{t("settings.team.languagesLegend")}</legend>
      {COMMON_SPOKEN_LANGUAGES.map((language) => (
        <label
          key={language}
          className="flex min-h-11 items-center gap-2 rounded-lg border border-border px-3 text-sm"
        >
          <input
            name={`language_${language}`}
            type="checkbox"
            defaultChecked={defaultLanguages.includes(language)}
            className="size-4 accent-primary"
          />
          {languageNameIn(language, locale) ?? language}
        </label>
      ))}
    </fieldset>
  );
}

function StaffRow({
  member,
  notice,
  priorRoles,
  locale,
  t,
}: {
  member: StaffMember;
  /** The page's one resolved notice, already told which form it belongs to. */
  notice: FormNotice | undefined;
  /** The roles this row held before the save it just made — its Undo, or nothing. */
  priorRoles: Role[];
  locale: string;
  t: StaffTranslator;
}) {
  const status = statusBadge(t)[member.accountStatus];
  const isDisabled = member.accountStatus === "disabled";
  const labels = roleLabels(t);
  const held = STAFF_ROLES.filter((role) => member.roles.includes(role));
  const rolesNotice = noticeForForm(notice, TEAM_FORMS.roles(member.personId));
  const contactStatus = noticeForForm(notice, TEAM_FORMS.contact(member.personId));
  const languagesStatus = noticeForForm(notice, TEAM_FORMS.languages(member.personId));
  return (
    <li id={`staff-${member.personId}`} className="min-w-0 scroll-mt-24 px-5 py-4 sm:px-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="font-medium">{member.fullName}</p>
          <p className="text-sm text-muted">{member.email}</p>
        </div>
        <Badge tone={status.tone}>{status.label}</Badge>
      </div>

      {/* Roles read as words at rest and open in place to be edited; closing
          the row is the save (ADR 20260827-the-shops-shelves, slice 9h). */}
      <div className="mt-4">
        <StaffRolesDisclosure
          personId={member.personId}
          summary={
            held.length > 0
              ? cachedListFormat(locale).format(held.map((role) => labels[role]))
              : t("settings.team.rolesLegend")
          }
          legend={t("settings.team.rolesLegend")}
          editLabel={t("settings.team.roles.editAriaLabel", { name: member.fullName })}
          options={STAFF_ROLES.map((role) => ({
            value: role,
            label: labels[role],
            checked: member.roles.includes(role),
          }))}
          action={saveStaffRolesAction}
          refusal={rolesNotice?.tone === "danger" ? rolesNotice.text : undefined}
          // Composed here — it is an answer about the save that just landed,
          // not a control on the panel — but rendered *inside* the row, so
          // reaching for it never closes-and-saves the row on the way and
          // turns one Undo into two writes.
          footer={
            rolesNotice?.tone === "success" ? (
              <div className="mt-2 flex flex-wrap items-center gap-3">
                <FormStatus tone="success">{rolesNotice.text}</FormStatus>
                {/* Undo is one re-save of exactly what this row held a moment
                    ago — `undo=1` so the answer to it offers no undo back, and
                    `baseline` so an Undo left on screen while somebody else
                    edited the same person refuses instead of reverting them. */}
                {priorRoles.length > 0 ? (
                  <form action={saveStaffRolesAction}>
                    <input type="hidden" name="personId" value={member.personId} />
                    <input type="hidden" name="undo" value="1" />
                    <input type="hidden" name="baseline" value={[...held].sort().join(",")} />
                    {priorRoles.map((role) => (
                      <input key={role} type="hidden" name={`role_${role}`} value="on" />
                    ))}
                    <SubmitButton
                      pendingLabel={t("shared.undoToast.pendingLabel")}
                      ariaLabel={t("settings.team.roles.undoAriaLabel", { name: member.fullName })}
                      className={buttonClass({ variant: "secondary", size: "sm" })}
                    >
                      {t("shared.undoToast.undo")}
                    </SubmitButton>
                  </form>
                ) : null}
              </div>
            ) : undefined
          }
        />
      </div>

      {/* What this person can say to a diver, shown to divers before they
          book (a shop's "we speak …" line and each trip's crew section) and
          nowhere gated — a shop that never fills this in loses nothing
          (issue #708). Its own immediate form, like the emergency contact
          below. */}
      <div className="mt-4">
        <CompactDisclosureRow
          id={`languages-${member.personId}`}
          label={t("settings.team.languagesLabel")}
          value={
            member.spokenLanguages.length > 0
              ? cachedListFormat(locale).format(
                  member.spokenLanguages.map(
                    (language) => languageNameIn(language, locale) ?? language,
                  ),
                )
              : t("settings.team.languagesEmpty")
          }
          open={Boolean(languagesStatus)}
        >
          <form action={saveStaffLanguagesAction} className="flex flex-col gap-3">
            <input type="hidden" name="personId" value={member.personId} />
            <LanguageCheckboxes defaultLanguages={member.spokenLanguages} locale={locale} t={t} />
            <div className="flex flex-wrap items-center gap-3">
              <SubmitButton
                pendingLabel={t("settings.team.languagesSaving")}
                className={buttonClass({ variant: "secondary", size: "sm" })}
              >
                {t("settings.team.languagesSave")}
              </SubmitButton>
              <FormStatus tone={languagesStatus?.tone}>{languagesStatus?.text}</FormStatus>
            </div>
          </form>
        </CompactDisclosureRow>
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
      <div className="mt-4">
        <CompactDisclosureRow
          id={`emergency-contact-${member.personId}`}
          label={t("settings.team.emergencyContact.summaryEmpty")}
          value={
            member.emergencyContactName && member.emergencyContactPhone
              ? member.emergencyContactName
              : undefined
          }
          open={Boolean(contactStatus)}
        >
          <FieldGrid
            as="form"
            action={saveStaffEmergencyContactAction}
            columns={2}
            className="mt-3"
          >
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
        </CompactDisclosureRow>
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
    </li>
  );
}

/** A `?priorRoles=` value, kept to roles this app actually has. */
function parseRoles(value: string | undefined): Role[] {
  return (value ?? "")
    .split(",")
    .filter((role): role is Role => (STAFF_ROLES as readonly string[]).includes(role));
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
    languagesFor?: string;
    rolesFor?: string;
    priorRoles?: string;
  }>;
}) {
  const { shopSlug } = await params;
  const {
    notice,
    undoPersonId,
    undoUserAccountId,
    undoRoles,
    undoName,
    contactFor,
    languagesFor,
    rolesFor,
    priorRoles,
  } = await searchParams;
  // Settings, not Today: Team is a Settings sub-page, and the nearest parent
  // surface is where a refusal explains itself best (the same landing the
  // promos and WhatsApp gates already use). A code the destination handles,
  // never a silent teleport (task 82).
  const { db, shop } = await requireShopSurface(shopSlug, {
    allow: canPersonManageStaffAccounts,
    refusal: { notice: "team-not-authorized" },
  });

  const staff = await listShopStaff(db, shop.id);
  const locale = await requestLocale(shop.defaultLocale);
  const t = staffTranslator(locale);
  // One resolution, then `noticeForForm` hands each form its own: the invite
  // box, the invite form, and — per person — roles, languages, and the
  // emergency contact. What is left for the page banner is what is genuinely
  // about the page (`./notices.ts`).
  const resolved = noticeFromParam(notice, noticeMessages(t));
  // `teamNoticeOnRoster` is the second half, and it is not decoration: three of
  // these codes are emitted precisely *because* the person is no longer live
  // staff of this shop, which is the same condition `listShopStaff` filters on
  // — so the row the answer names is the one row that is not here to render it.
  // Without the demotion that refusal renders nowhere at all.
  const pageNotice: FormNotice | undefined =
    notice && resolved
      ? {
          form: teamNoticeOnRoster(
            teamNoticeForm(notice, { rolesFor, contactFor, languagesFor }),
            staff.map((member) => member.personId),
          ),
          ...resolved,
        }
      : undefined;
  const inviteEmailError = noticeForForm(pageNotice, TEAM_FORMS.inviteEmail)?.text;
  const inviteStatus = noticeForForm(pageNotice, TEAM_FORMS.invite);
  const pageBanner = noticeForForm(pageNotice, TEAM_FORMS.page);
  const undoRolesFor = parseRoles(priorRoles);

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
          "languagesFor",
          "rolesFor",
          "priorRoles",
        ]}
      />
      <ShopPageHeader
        eyebrow={t("settings.team.eyebrow")}
        eyebrowHref={`/shop/${shopSlug}/settings`}
        title={t("settings.team.title")}
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
            <EmptyState
              title={t("settings.team.current.empty")}
              action={
                <a href="#invite" className={buttonClass({ size: "sm", className: "mt-4" })}>
                  {t("settings.team.current.emptyAction")}
                </a>
              }
              className="mt-4"
            />
          ) : (
            <InsetGroup className="mt-4" bodyAs="ul">
              {staff.map((member) => (
                <StaffRow
                  key={member.personId}
                  member={member}
                  notice={pageNotice}
                  priorRoles={rolesFor === member.personId ? undoRolesFor : []}
                  locale={locale}
                  t={t}
                />
              ))}
            </InsetGroup>
          )}
        </section>
      </div>
    </main>
  );
}
