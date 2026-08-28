/**
 * Which form on the team page a `?notice=` belongs to.
 *
 * The page has one invite form and, per teammate, three more — roles,
 * languages, an emergency contact. `src/lib/staff-notices.ts` already answers
 * *what happened*; this answers *where that answer belongs*, so the page can
 * hand each form its own outcome with `noticeForForm` instead of resolving
 * sixty codes into one banner under the `<h1>`.
 *
 * It matters most for the per-row roles disclosure (ADR
 * 20260827-the-shops-shelves, slice 9h): a role refusal reopens the row it
 * came from with the words beside the checkboxes, and a refusal that escaped
 * to the page banner would be a refusal about a person the reader has
 * scrolled past. `ROLE_REFUSALS` below is the list a test holds this to.
 */

/** The one spelling of each form's name, so the page and its tests agree. */
export const TEAM_FORMS = {
  page: "page",
  invite: "invite",
  /** The Email box specifically — three refusals are about that address. */
  inviteEmail: "invite-email",
  roles: (personId: string) => `roles:${personId}`,
  contact: (personId: string) => `contact:${personId}`,
  languages: (personId: string) => `languages:${personId}`,
} as const;

/** Every refusal one row's roles disclosure can produce. */
export const ROLE_REFUSALS = [
  "roles-invalid",
  "last-owner",
  "not-found",
  "roles-conflict",
] as const;

/** Those plus the confirmation, which lands on the same row (it carries Undo). */
const ROLE_NOTICES = new Set<string>([...ROLE_REFUSALS, "changes-saved"]);
const CONTACT_NOTICES = new Set(["contact-saved", "half-filled", "not-found"]);
const LANGUAGE_NOTICES = new Set(["languages-saved", "not-found"]);
const INVITE_EMAIL_NOTICES = new Set([
  "invite-already-on-team",
  "invite-email-taken",
  "invite-email-reserved",
]);
const INVITE_NOTICES = new Set(["invited", "invite-invalid"]);

/**
 * Which row a per-row outcome is about. Each action names its own row on the
 * way back, so `not-found` — a code three of the four forms can emit — is
 * never guessed at.
 */
export type TeamNoticeTargets = {
  rolesFor?: string;
  contactFor?: string;
  languagesFor?: string;
};

/** The three per-row forms, by the prefix `TEAM_FORMS` gives each of them. */
const ROW_FORM_PREFIXES = ["roles:", "contact:", "languages:"] as const;

/**
 * The same answer, demoted to the page banner when the row it names is not on
 * the roster.
 *
 * `teamNoticeForm` decides where an outcome *belongs*; this decides whether
 * that place exists. They come apart for one refusal in particular:
 * `setStaffRoles` answers `not_found` when the person is not live staff of this
 * shop, and `listShopStaff` filters on exactly the same condition — so the very
 * thing that produced the refusal is what took its row off the page (a
 * teammate deleted from another tab, say). Left alone, that refusal would
 * render nowhere at all, and a silent refusal is the one outcome a refusal must
 * never be (`noticeCode`, src/lib/staff-notices.ts).
 */
export function teamNoticeOnRoster(form: string, personIds: readonly string[]): string {
  const prefix = ROW_FORM_PREFIXES.find((candidate) => form.startsWith(candidate));
  if (!prefix) return form;
  return personIds.includes(form.slice(prefix.length)) ? form : TEAM_FORMS.page;
}

export function teamNoticeForm(code: string, targets: TeamNoticeTargets): string {
  const { rolesFor, contactFor, languagesFor } = targets;
  if (rolesFor && ROLE_NOTICES.has(code)) return TEAM_FORMS.roles(rolesFor);
  if (contactFor && CONTACT_NOTICES.has(code)) return TEAM_FORMS.contact(contactFor);
  if (languagesFor && LANGUAGE_NOTICES.has(code)) return TEAM_FORMS.languages(languagesFor);
  if (INVITE_EMAIL_NOTICES.has(code)) return TEAM_FORMS.inviteEmail;
  if (INVITE_NOTICES.has(code)) return TEAM_FORMS.invite;
  return TEAM_FORMS.page;
}
