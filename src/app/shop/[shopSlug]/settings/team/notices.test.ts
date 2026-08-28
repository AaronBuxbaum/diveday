import { describe, expect, it } from "vitest";
import { ROLE_REFUSALS, TEAM_FORMS, teamNoticeForm, teamNoticeOnRoster } from "./notices";

const PERSON = "person-1";
const OTHER = "person-2";

/**
 * The routing half of slice 9h's rule (ADR 20260827-the-shops-shelves): a role
 * refusal lands on the row that produced it, never as a banner above a roster
 * of eleven people. The page's rendering half is pinned in
 * `_components/StaffRolesDisclosure.test.tsx`.
 */
describe("teamNoticeForm", () => {
  it("never routes a role refusal to the page banner", () => {
    for (const code of ROLE_REFUSALS) {
      const form = teamNoticeForm(code, { rolesFor: PERSON });
      expect(form).toBe(TEAM_FORMS.roles(PERSON));
      expect(form).not.toBe(TEAM_FORMS.page);
    }
  });

  it("puts a role confirmation on the same row, because that is where Undo is offered", () => {
    expect(teamNoticeForm("changes-saved", { rolesFor: PERSON })).toBe(TEAM_FORMS.roles(PERSON));
  });

  it("routes to the row each action named, so the code three forms share is never guessed at", () => {
    // `not-found` can come from the roles disclosure, the languages form, or
    // the emergency contact. The param, not the code, is what decides.
    expect(teamNoticeForm("not-found", { rolesFor: PERSON })).toBe(TEAM_FORMS.roles(PERSON));
    expect(teamNoticeForm("not-found", { languagesFor: PERSON })).toBe(
      TEAM_FORMS.languages(PERSON),
    );
    expect(teamNoticeForm("not-found", { contactFor: PERSON })).toBe(TEAM_FORMS.contact(PERSON));
    expect(teamNoticeForm("contact-saved", { contactFor: OTHER })).toBe(TEAM_FORMS.contact(OTHER));
  });

  it("keeps the invite form's outcomes, and its email box's, off the roster's rows", () => {
    expect(teamNoticeForm("invite-email-taken", { rolesFor: PERSON })).toBe(TEAM_FORMS.inviteEmail);
    expect(teamNoticeForm("invited", { rolesFor: PERSON })).toBe(TEAM_FORMS.invite);
  });

  it("cannot place a role refusal that names no row, and says so rather than guessing", () => {
    // The other half of the first test. Every one of these codes is a refusal,
    // so the one thing that may not happen is it rendering nowhere: with no
    // `rolesFor` there is no row to put it on, and the page banner is the only
    // honest place left.
    for (const code of ROLE_REFUSALS) {
      expect(teamNoticeForm(code, {})).toBe(TEAM_FORMS.page);
    }
  });

  it("leaves the page banner what is genuinely about the page", () => {
    // A permission refusal that bounced the reader here from somewhere else,
    // and the account-status outcomes that name no row.
    expect(teamNoticeForm("not-authorized", {})).toBe(TEAM_FORMS.page);
    expect(teamNoticeForm("removed", {})).toBe(TEAM_FORMS.page);
    expect(teamNoticeForm("disabled", {})).toBe(TEAM_FORMS.page);
    // A row code with no row named cannot be placed, so it stays on the page
    // rather than being pinned to an arbitrary teammate.
    expect(teamNoticeForm("roles-invalid", {})).toBe(TEAM_FORMS.page);
  });
});

/**
 * The routing decides where an answer belongs; this decides whether that place
 * is on the page at all. They come apart for the refusal whose own cause is
 * the row's absence — `setStaffRoles` answers `not_found` when the person is
 * not live staff of this shop, and `listShopStaff` drops exactly those people.
 */
describe("teamNoticeOnRoster", () => {
  const ROSTER = [PERSON, OTHER];

  it("keeps a per-row answer on its row while that row is on the roster", () => {
    expect(teamNoticeOnRoster(TEAM_FORMS.roles(PERSON), ROSTER)).toBe(TEAM_FORMS.roles(PERSON));
    expect(teamNoticeOnRoster(TEAM_FORMS.contact(OTHER), ROSTER)).toBe(TEAM_FORMS.contact(OTHER));
    expect(teamNoticeOnRoster(TEAM_FORMS.languages(PERSON), ROSTER)).toBe(
      TEAM_FORMS.languages(PERSON),
    );
  });

  it("demotes a refusal whose row is gone to the page banner, so it is never swallowed", () => {
    // The reachable case: a teammate deleted from another tab. Every one of
    // these would otherwise render nowhere — the row that would have carried
    // it is the row that stopped existing.
    const gone = "person-gone";
    for (const form of [
      TEAM_FORMS.roles(gone),
      TEAM_FORMS.contact(gone),
      TEAM_FORMS.languages(gone),
    ]) {
      expect(teamNoticeOnRoster(form, ROSTER)).toBe(TEAM_FORMS.page);
    }
    expect(teamNoticeOnRoster(TEAM_FORMS.roles(PERSON), [])).toBe(TEAM_FORMS.page);
  });

  it("leaves the forms that are not a row's alone", () => {
    for (const form of [TEAM_FORMS.page, TEAM_FORMS.invite, TEAM_FORMS.inviteEmail]) {
      expect(teamNoticeOnRoster(form, [])).toBe(form);
    }
  });
});
