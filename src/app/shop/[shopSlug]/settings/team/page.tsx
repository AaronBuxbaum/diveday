import type { Metadata } from "next";
import { AutoOpenDetails } from "@/components/AutoOpenDetails";
import { EmptyState } from "@/components/EmptyState";
import { FlashParams } from "@/components/FlashParams";
import { ShopPageHeader } from "@/components/ShopPageHeader";
import { StaffNoticeBanner } from "@/components/StaffNoticeBanner";
import { SubmitButton } from "@/components/SubmitButton";
import { UndoToast } from "@/components/UndoToast";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { CompactDisclosureRow } from "@/components/ui/disclosure";
import {
  ChoicePill,
  controlClass,
  DateField,
  Field,
  FieldActions,
  FieldGrid,
  FormStatus,
} from "@/components/ui/form";
import { InsetGroup } from "@/components/ui/ledger";
import { SECTION_TITLE_CLASS } from "@/components/ui/typography";
import { canPersonManageStaffAccounts } from "@/db/authz";
import { listShopStaff, type StaffMember } from "@/db/staff-accounts";
import { listStaffCredentials } from "@/db/staff-credentials";
import { languageNameIn } from "@/i18n/language-labels";
import { requestLocale } from "@/i18n/request";
import { type StaffTranslator, staffTranslator } from "@/i18n/staff-messages";
import { staffRoleLabelRecord } from "@/i18n/staff-role-labels";
import { type Role, STAFF_ROLES } from "@/lib/authz";
import { calendarDateInTimezone } from "@/lib/calendar-date";
import { nowDate } from "@/lib/clock";
import { formatDateWithYear } from "@/lib/format";
import { cachedListFormat } from "@/lib/intl-cache";
import { requireShopSurface } from "@/lib/session";
import { COMMON_SPOKEN_LANGUAGES } from "@/lib/spoken-languages";
import { type FormNotice, noticeForForm, noticeFromParam } from "@/lib/staff-notices";
import { settingsPaneClass } from "../_components/settings-pane";
import { InviteStaffDisclosure } from "./_components/InviteStaffDisclosure";
import { StaffCardCredentials } from "./_components/StaffCardCredentials";
import { StaffRolesDisclosure } from "./_components/StaffRolesDisclosure";
import { type CrewYear, readStaffYears, StaffYearLine } from "./_components/StaffYear";
import {
  deleteStaffCredentialAction,
  removeStaffAction,
  resendInviteAction,
  restoreStaffAction,
  reviewStaffCredentialAction,
  saveStaffCredentialAction,
  saveStaffEmergencyContactAction,
  saveStaffLanguagesAction,
  saveStaffRolesAction,
  setStaffStatusAction,
} from "./actions";
import { CREDENTIAL_KIND_KEYS } from "./credential-kinds";
import { type CardCredential, credentialRowsFor } from "./credential-rows";
import { noticeMessages } from "./notice-messages";
import { parseRoles, TEAM_FORMS, teamNoticeForm, teamNoticeOnRoster } from "./notices";

// `instant = true` asserts that navigating *into* this page paints
// immediately — this segment's `loading.tsx`, with no request read above it.
// Since the staff shell became synchronous (issue 1446) that holds for a cold,
// direct visit too: the shell's session, shop row and nav stream in beside the
// page from `ShopChrome` rather than above it, so the route gets a static
// shell and its own reads are the only ones the reader waits on. See ADR
// 20260804-instant-navigation.
export const instant = true;

export const metadata: Metadata = { title: "Team — DiveDay" };

/**
 * **Only the exceptional state wears a badge.** Four rows each carrying a green
 * "Active" is the expected state formatted as information, which is principle
 * 9's whole subject — the roster's answer to "is this person on?" is that they
 * are on the roster. An account that is waiting on its invite or switched off
 * is the fact a reader came for, and `active` is deliberately absent from this
 * record so a future state has to decide rather than default into a pill.
 */
function statusBadge(
  t: StaffTranslator,
): Record<Exclude<StaffMember["accountStatus"], "active">, { label: string; tone: BadgeTone }> {
  return {
    invited: { label: t("settings.team.statusBadge.invited"), tone: "warning" },
    disabled: { label: t("settings.team.statusBadge.disabled"), tone: "neutral" },
  };
}

/**
 * Display labels for every staff role, translated for this page only.
 * `STAFF_ROLE_LABELS` in `src/lib/authz.ts` also holds English role labels
 * (used by the invite email in `./actions.ts`) — out of this batch's scope,
 * flagged in the extraction report rather than changed here.
 */
const roleLabels = staffRoleLabelRecord;

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
        <ChoicePill
          key={language}
          type="checkbox"
          name={`language_${language}`}
          defaultChecked={defaultLanguages.includes(language)}
        >
          {languageNameIn(language, locale) ?? language}
        </ChoicePill>
      ))}
    </fieldset>
  );
}

/**
 * The name divers actually read for this person, or empty when they read none.
 *
 * **Both conditions, because this row makes a claim about a page it is not**
 * (issue #1357, tightened by a security pass on the commit that added it).
 * `tripPublicCrew` (`src/db/trips-record.ts`) requires the consent stamp, a
 * live person **and an `active` account** — so a divemaster who consented and
 * was later disabled vanishes from every public page while their roster row
 * went on saying "Divers see “Mar”". Disabling deliberately leaves the consent
 * standing (`setStaffAccountStatus` — a temporary disable should not destroy a
 * standing answer), which is right, and is exactly why the reader has to check
 * the second condition rather than infer it.
 *
 * `trim()` rather than truthiness for the same reason one layer down: the
 * check constraint pairs the stamp with a name that is non-blank **after
 * Postgres `btrim`**, which strips ASCII space and nothing else. No writer can
 * produce a tab-only name today — `crewPublicNameToStore` collapses every
 * `\p{Cc}` to a space and trims — but a roster is a poor place to learn that a
 * default changed.
 */
function publicName(member: StaffMember): string {
  if (member.accountStatus !== "active") return "";
  return member.crewPublicName?.trim() ?? "";
}

function StaffRow({
  member,
  credentials,
  notice,
  priorRoles,
  locale,
  timezone,
  t,
  year,
}: {
  member: StaffMember;
  /** This person's credentials on file: the card is their whole ledger (A09). */
  credentials: readonly CardCredential[];
  /** The page's one resolved notice, already told which form it belongs to. */
  notice: FormNotice | undefined;
  /** The roles this row held before the save it just made — its Undo, or nothing. */
  priorRoles: Role[];
  locale: string;
  /** The shop's own zone, so a consent stamp reads as the day the shop lived. */
  timezone: string;
  t: StaffTranslator;
  year?: CrewYear;
}) {
  const isDisabled = member.accountStatus === "disabled";
  const status = member.accountStatus === "active" ? null : statusBadge(t)[member.accountStatus];
  const labels = roleLabels(t);
  const held = STAFF_ROLES.filter((role) => member.roles.includes(role));
  const rolesNotice = noticeForForm(notice, TEAM_FORMS.roles(member.personId));
  const contactStatus = noticeForForm(notice, TEAM_FORMS.contact(member.personId));
  const languagesStatus = noticeForForm(notice, TEAM_FORMS.languages(member.personId));
  return (
    <li id={`staff-${member.personId}`} className="min-w-0 scroll-mt-24 px-5 py-4 sm:px-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="font-medium">{member.fullName}</p>
          <p className="text-sm text-muted wrap-anywhere">{member.email}</p>
          <StaffYearLine year={year} t={t} />
          {/* What this person publishes to divers, when they have said yes on
              their own staffing page (issue #1357). Read-only here: the switch
              is theirs, and a shop that could edit it would be overriding
              somebody's consent from the other side. Nothing at all for
              somebody who declined — a row that said so would be a list of who
              declined, which is the boundary the feature rests on. */}
          {/* The stamp rides the name and only the name: a row with no name
              shows nothing at all, so a declined answer and a never-asked one
              stay indistinguishable (issue #1357). */}
          {publicName(member) && member.crewPublicConsentAt ? (
            <p className="text-sm text-muted">
              {t("settings.team.publicNameSeen", {
                name: publicName(member),
                date: formatDateWithYear(member.crewPublicConsentAt, locale, timezone),
              })}
            </p>
          ) : null}
        </div>
        {status ? <Badge tone={status.tone}>{status.label}</Badge> : null}
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
              : t("settings.team.emergencyContact.addValue")
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

      <StaffCardCredentials
        personId={member.personId}
        roles={member.roles}
        credentials={credentials}
        locale={locale}
        t={t}
        reviewAction={reviewStaffCredentialAction}
        deleteAction={deleteStaffCredentialAction}
      />

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
          label={t("settings.team.emergencyContact.label")}
          // The label names the fact, the value answers it — the row used to
          // say "Add an emergency contact" beside "Marisol Reyes (wife)".
          value={
            member.emergencyContactName && member.emergencyContactPhone
              ? member.emergencyContactName
              : t("settings.team.emergencyContact.addValue")
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

      {/* One of two things, never both: Resend at the start for somebody still
          invited, or the account's switches at the end for everybody else.
          The Resend slot used to be an empty `<div>` on every other card,
          which took this row's 8px gap and pushed the switches 8px down on a
          phone (the pixel probe, settings-team). `sm:ms-auto` holds the
          switches to the end without a placeholder holding the start. */}
      <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
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
        {member.accountStatus !== "invited" ? (
          <div className="flex gap-2 sm:ms-auto">
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
                // Disable is demoted from a standing `secondary`: switching a
                // colleague off is rare and consequential, and a bordered
                // button on every one of four cards read as one of the row's
                // ordinary moves. Ghost weight in the danger hue is the pair
                // `button.ts` documents for a rare destructive act sitting
                // among quiet ones. Enable is the recovery from it and keeps
                // ordinary secondary weight.
                className={buttonClass({
                  variant: isDisabled ? "secondary" : "danger-ghost",
                  size: "sm",
                  // On `danger-ghost`, the word ends on the card's edge (the
                  // rows' values above end there), and the unseen half of its
                  // target sinks into the card's padding, so the card has as
                  // much room under "Disable" as over the name. A `secondary`
                  // box ignores both.
                  flush: true,
                  outdent: "block-end",
                  // The outdent leaves the box 4px above the row's rule, inside
                  // a list that clips: the outset ring would paint over the
                  // hairline, and lose its last pixel on the last card. The
                  // Enable box sits 16px clear and keeps the app's ring.
                  className: isDisabled ? undefined : "focus-visible:focus-ring-inset",
                })}
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

  const [staff, credentials, years] = await Promise.all([
    listShopStaff(db, shop.id),
    listStaffCredentials(db, shop.id),
    readStaffYears(db, shop, nowDate()),
  ]);
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
  // Through the clock and the shop's zone: this decides which renewals read
  // as due soon or expired.
  const today = calendarDateInTimezone(nowDate(), shop.timezone);
  const credentialRows = credentialRowsFor(credentials, today, locale, t);
  const needReview = credentialRows.filter((row) => !row.reviewed).length;
  return (
    <main className={settingsPaneClass("5xl")}>
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
        eyebrow={t("settings.main.eyebrow")}
        eyebrowHref={`/shop/${shopSlug}/settings`}
        title={t("settings.team.title")}
        description={
          needReview > 0
            ? t("settings.team.credentialsNeedReview", { count: needReview })
            : undefined
        }
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
          dismissLabel={t("shared.undoToast.dismiss")}
        />
      ) : pageBanner ? (
        <StaffNoticeBanner tone={pageBanner.tone}>{pageBanner.text}</StaffNoticeBanner>
      ) : null}

      {/* Section rhythm belongs to the page, not to each section: one
          `space-y-10` here, and no `mt-*` on any card
          (docs/design/forms-and-controls.md). */}
      <div className="space-y-10">
        {/* The team first; inviting is a button under its heading (item 58). */}
        <section>
          {/* Not a card — a heading over a list of them, so a bare `h2` at
              `SECTION_TITLE_CLASS`, the rung `SectionCard` draws its own title
              at and `card.tsx` prescribes for a heading over a plural body. */}
          <h2 className={SECTION_TITLE_CLASS}>{t("settings.team.current.heading")}</h2>
          <InviteStaffDisclosure
            emailError={inviteEmailError}
            status={inviteStatus}
            notice={notice}
            t={t}
          />
          {staff.length === 0 ? (
            <EmptyState
              title={t("settings.team.current.empty")}
              action={
                <a href="#invite" className={buttonClass({ size: "sm" })}>
                  {t("settings.team.current.emptyAction")}
                </a>
              }
              className="mt-4"
            />
          ) : (
            // `#credentials` lands here, on the cards (Today's and the
            // staffing week's credential lines link to it): an expired or
            // unreviewed credential stands on its person's card at rest.
            <div id="credentials" className="mt-4 scroll-mt-24">
              <InsetGroup bodyAs="ul">
                {staff.map((member) => (
                  <StaffRow
                    key={member.personId}
                    member={member}
                    credentials={credentialRows.filter((row) => row.personId === member.personId)}
                    notice={pageNotice}
                    priorRoles={rolesFor === member.personId ? undoRolesFor : []}
                    locale={locale}
                    timezone={shop.timezone}
                    t={t}
                    year={years.get(member.personId)}
                  />
                ))}
              </InsetGroup>
            </div>
          )}
          {/* Every credential is read, reviewed and removed on its person's
              card above (A09); adding one is the door under the team. */}
          <div className="mt-4">
            <AutoOpenDetails
              id="add-credential"
              openOnHash="add-credential"
              className="scroll-mt-8"
            >
              <summary
                className={buttonClass({
                  variant: "link",
                  flush: true,
                  className: "list-none select-none [&::-webkit-details-marker]:hidden",
                })}
              >
                {t("staffing.credentials.add")}
              </summary>
              <div className="pt-1 pb-6">
                <FieldGrid as="form" action={saveStaffCredentialAction} columns={2}>
                  <Field label={t("staffing.credentials.person")}>
                    <select name="personId" required className={controlClass}>
                      <option value="">{t("staffing.credentials.choosePerson")}</option>
                      {staff.map((member) => (
                        <option key={member.personId} value={member.personId}>
                          {member.fullName}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label={t("staffing.credentials.kind")}>
                    <select name="kind" required className={controlClass}>
                      {Object.entries(CREDENTIAL_KIND_KEYS).map(([kind, key]) => (
                        <option key={kind} value={kind}>
                          {t(key)}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label={t("staffing.credentials.name")}>
                    <input name="name" required maxLength={160} className={controlClass} />
                  </Field>
                  <Field label={t("staffing.credentials.issuer")}>
                    <input name="issuingBody" maxLength={160} className={controlClass} />
                  </Field>
                  <Field label={t("staffing.credentials.identifier")}>
                    <input name="identifier" maxLength={120} className={controlClass} />
                  </Field>
                  <Field label={t("staffing.credentials.issuedAt")}>
                    <DateField name="issuedAt" />
                  </Field>
                  <Field label={t("staffing.credentials.renewsAt")}>
                    <DateField name="renewsAt" />
                  </Field>
                  <FieldActions>
                    <SubmitButton
                      pendingLabel={t("staffing.credentials.saving")}
                      className={buttonClass()}
                    >
                      {t("staffing.credentials.add")}
                    </SubmitButton>
                  </FieldActions>
                </FieldGrid>
              </div>
            </AutoOpenDetails>
          </div>
        </section>
      </div>
    </main>
  );
}
