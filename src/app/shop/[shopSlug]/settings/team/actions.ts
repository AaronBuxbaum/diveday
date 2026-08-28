"use server";

import { redirect } from "next/navigation";
import { after } from "next/server";
import { z } from "zod";
import { issueAccountToken } from "@/db/account-tokens";
import { canPersonManageStaffAccounts } from "@/db/authz";
import { getDb } from "@/db/client";
import { sendNotification } from "@/db/notifications";
import { getShopById } from "@/db/shops";
import {
  getStaffRoles,
  inviteStaffMember,
  listShopStaff,
  removeStaffMember,
  setStaffAccountStatus,
  setStaffEmergencyContact,
  setStaffLanguages,
  setStaffRoles,
} from "@/db/staff-accounts";
import { revokeFeedsForFormerStaff } from "@/features/calendar-sync";
import { toDiverLocale } from "@/i18n/settings";
import { inviteLinkPath } from "@/lib/account-tokens";
import { type Role, STAFF_ROLE_LABELS, STAFF_ROLES } from "@/lib/authz";
import { revalidateAndRedirect } from "@/lib/navigation";
import { publicAppUrl } from "@/lib/notifications";
import { requireStaffSession } from "@/lib/session";
import { COMMON_SPOKEN_LANGUAGES } from "@/lib/spoken-languages";
import { noticeUrl, shopPath } from "@/lib/staff-notices";

/**
 * This page's own path, with the slug escaped. It arrives on the session, but
 * every action here is a POST endpoint whose id ships to the browser, so the
 * path is built rather than interpolated — see `shopPath` in
 * src/lib/staff-notices.ts.
 */
function teamPath(shopSlug: string): string {
  return shopPath(shopSlug, "settings", "team");
}

/** Refuses here so callers cannot forget to act on a returned redirect target. */
async function teamManagementBlock(session: {
  user: { shopId: string; personId: string; shopSlug: string };
}): Promise<void> {
  const path = teamPath(session.user.shopSlug);
  const allowed = await canPersonManageStaffAccounts(
    await getDb(),
    session.user.shopId,
    session.user.personId,
  );
  if (!allowed) redirect(noticeUrl(path, "not-authorized"));
}

function rolesFromFormData(formData: FormData): Role[] {
  return STAFF_ROLES.filter((role) => formData.get(`role_${role}`) === "on");
}

/** One set of roles as a value two requests can compare — order-free. */
function rolesKey(roles: readonly string[]): string {
  return [...roles].sort().join(",");
}

// No message arguments. A Zod message is a sentence in the language whoever
// typed the schema happened to speak, and `pnpm check:copy` cannot see a string
// literal passed as a validator argument — so one lands in the UI untranslated
// the first time a caller renders `error.issues[].message`. This schema fails
// with issue codes; the page turns a refusal into a `?notice=invite-invalid`
// and the staff bundle picks the words.
const inviteSchema = z.object({
  fullName: z.string().trim().min(1).max(120),
  email: z.string().trim().toLowerCase().pipe(z.email().max(150)),
});

/** Sends a staff invite email deferred past the response, matching onboardAction's pattern. */
async function sendInviteEmail(input: {
  userAccountId: string;
  shopId: string;
  shopName: string;
  to: string;
  locale: string;
  inviteeName: string;
  inviterName: string;
  roles: Role[];
  timezone: string;
}) {
  const origin = publicAppUrl();
  if (!origin) return;
  const issued = await issueAccountToken(await getDb(), {
    userAccountId: input.userAccountId,
    purpose: "invite",
  }).catch((error: unknown) => {
    // Without this line the invite silently never sends and the inviter has
    // no way to know — the page already told them it did.
    console.error("sendInviteEmail: invite token failed", error);
    return null;
  });
  if (!issued) return;
  after(async () => {
    await sendNotification(await getDb(), {
      kind: "staff_invite",
      userAccountId: input.userAccountId,
      tokenId: issued.tokenId,
      shopId: input.shopId,
      to: input.to,
      locale: toDiverLocale(input.locale),
      inviteeName: input.inviteeName,
      shopName: input.shopName,
      inviterName: input.inviterName,
      roleLabels: input.roles.map((role) => STAFF_ROLE_LABELS[role]),
      inviteUrl: new URL(inviteLinkPath(issued.token), `${origin}/`).toString(),
      expiresAt: issued.expiresAt,
      timezone: input.timezone,
    }).catch(() => ({ status: "failed" as const }));
  });
}

export async function inviteStaffAction(formData: FormData) {
  const session = await requireStaffSession();
  const path = teamPath(session.user.shopSlug);
  await teamManagementBlock(session);

  const parsed = inviteSchema.safeParse(Object.fromEntries(formData));
  const roles = rolesFromFormData(formData);
  if (!parsed.success || roles.length === 0) {
    redirect(noticeUrl(path, "invite-invalid"));
  }

  const db = await getDb();
  const shop = await getShopById(db, session.user.shopId);
  if (!shop) redirect(path);

  const result = await inviteStaffMember(db, {
    shopId: session.user.shopId,
    fullName: parsed.data.fullName,
    email: parsed.data.email,
    roles,
  });

  if (!result.ok) {
    // Exhaustive by construction: a new refusal code cannot reach the page
    // wordless (the same discipline `SEAT_SURFACES.refusalNotice` uses).
    const notice = {
      already_on_team: "invite-already-on-team",
      email_registered_elsewhere: "invite-email-taken",
      // The reserved demo namespace (ADR 20260803-demo-bypass-containment).
      email_reserved: "invite-email-reserved",
    }[result.reason];
    redirect(noticeUrl(path, notice));
  }

  await sendInviteEmail({
    userAccountId: result.userAccountId,
    shopId: session.user.shopId,
    shopName: shop.name,
    locale: shop.defaultLocale,
    to: parsed.data.email,
    inviteeName: parsed.data.fullName,
    inviterName: session.user.name ?? "A teammate",
    roles,
    timezone: shop.timezone,
  });

  revalidateAndRedirect(path, noticeUrl(path, "invited"));
}

async function findTeamMember(shopId: string, userAccountId: string) {
  const staff = await listShopStaff(await getDb(), shopId);
  return staff.find((member) => member.userAccountId === userAccountId) ?? null;
}

export async function resendInviteAction(formData: FormData) {
  const session = await requireStaffSession();
  const path = teamPath(session.user.shopSlug);
  await teamManagementBlock(session);

  const userAccountId = String(formData.get("userAccountId") ?? "");
  const member = await findTeamMember(session.user.shopId, userAccountId);
  if (member?.accountStatus !== "invited") redirect(path);

  const db = await getDb();
  const shop = await getShopById(db, session.user.shopId);
  if (!shop) redirect(path);

  await sendInviteEmail({
    userAccountId: member.userAccountId,
    shopId: session.user.shopId,
    shopName: shop.name,
    locale: shop.defaultLocale,
    to: member.email,
    inviteeName: member.fullName,
    inviterName: session.user.name ?? "A teammate",
    roles: member.roles,
    timezone: shop.timezone,
  });

  revalidateAndRedirect(path, noticeUrl(path, "invite-resent"));
}

/**
 * **One teammate's roles, saved when their row's disclosure closes** — ADR
 * 20260827-the-shops-shelves, slice 9h. It replaced `saveAllStaffRolesAction`,
 * a page-level "Save changes" that walked the whole roster in one submit: an
 * all-or-nothing write nobody asked for (one row left blank refused every
 * other row's edit), and a second mental model beside the immediate
 * Enable/Disable/Delete already on each row.
 *
 * Every answer names the row it is about — `rolesFor`, plus the `#staff-<id>`
 * fragment — so a refusal lands beside the checkboxes that caused it and never
 * as a banner above a roster of eleven people. `priorRoles` carries the
 * pre-save roles back for the row's one-tap Undo; an undo's own save posts
 * `undo=1` and hands nothing back, because Undo is a single re-save and not a
 * chain to walk up.
 *
 * The write is guarded by the `baseline` the row was rendered with, so a close
 * — or an Undo left on screen while somebody else edited the same person —
 * refuses rather than reverts. See the comment at that check.
 *
 * Enable/Disable/Delete stay separate immediate actions below, exactly as they
 * were — they never waited for the retired button and do not wait for this.
 */
export async function saveStaffRolesAction(formData: FormData) {
  const session = await requireStaffSession();
  const path = teamPath(session.user.shopSlug);
  await teamManagementBlock(session);

  const personId = String(formData.get("personId") ?? "");
  if (!personId) redirect(path);
  const rowPath = `${path}#staff-${personId}`;

  const roles = rolesFromFormData(formData);
  if (roles.length === 0) {
    redirect(noticeUrl(rowPath, "roles-invalid", { rolesFor: personId }));
  }

  const db = await getDb();
  // Snapshotted before the write, and only the `STAFF_ROLES` subset — exactly
  // what `setStaffRoles` replaces, so an Undo hands back the same shape.
  const before = await getStaffRoles(db, session.user.shopId, personId);

  // The roles the row was rendered with, posted back by the disclosure (and by
  // its Undo). `setStaffRoles` is a delete-then-insert of the whole staff
  // subset, so without this a second writer's close silently reverts whatever
  // the first one added — the lost update the course editor already refuses
  // rather than performs (`ConflictGuardedForm`, issue #820). Roles are the
  // higher-stakes copy of that surface: what is being overwritten is who may
  // reach every other gated surface in the shop.
  //
  // Absent means unchecked, and deliberately so: this is a concurrency guard,
  // not an authorization one — `teamManagementBlock` above is what a hand-made
  // post has to get past, and a caller who omits the field only forfeits being
  // told that somebody moved first.
  const baseline = formData.get("baseline");
  if (
    typeof baseline === "string" &&
    rolesKey(baseline.split(",").filter(Boolean)) !== rolesKey(before)
  ) {
    redirect(noticeUrl(rowPath, "roles-conflict", { rolesFor: personId }));
  }

  const result = await setStaffRoles(db, { shopId: session.user.shopId, personId, roles });
  if (!result.ok) {
    revalidateAndRedirect(path, noticeUrl(rowPath, result.reason, { rolesFor: personId }));
    return;
  }

  const isUndo = formData.get("undo") === "1";
  const changed = rolesKey(before) !== rolesKey(roles);
  revalidateAndRedirect(
    path,
    noticeUrl(rowPath, "changes-saved", {
      rolesFor: personId,
      priorRoles: isUndo || !changed ? undefined : before.join(","),
    }),
  );
}

/**
 * One staff member's emergency contact, from the team page.
 *
 * Behind the same `teamManagementBlock` gate as every other mutation here: an
 * emergency contact is personal data about a colleague, so it sits with role
 * and account management rather than being readable-and-writable by anyone who
 * can open the settings page.
 */
export async function saveStaffEmergencyContactAction(formData: FormData) {
  const session = await requireStaffSession();
  const path = teamPath(session.user.shopSlug);
  await teamManagementBlock(session);

  const personId = String(formData.get("personId") ?? "");
  if (!personId) redirect(path);

  const result = await setStaffEmergencyContact(await getDb(), {
    shopId: session.user.shopId,
    personId,
    name: String(formData.get("emergencyContactName") ?? ""),
    phone: String(formData.get("emergencyContactPhone") ?? ""),
  });
  // `contactFor` names the row that produced this, so the outcome renders in
  // that card's own action row rather than as a banner at the top of a page of
  // staff — the same routing the invite form's refusals already get, and what
  // docs/design/forms-and-controls.md asks of a form-level result.
  const notice = result.ok ? "contact-saved" : result.reason;
  revalidateAndRedirect(
    path,
    noticeUrl(`${path}#staff-${personId}`, notice, { contactFor: personId }),
  );
}

/**
 * One staff member's spoken languages, from the team page (issue #708).
 * Behind `teamManagementBlock`, the same gate every other mutation here uses.
 */
export async function saveStaffLanguagesAction(formData: FormData) {
  const session = await requireStaffSession();
  const path = teamPath(session.user.shopSlug);
  await teamManagementBlock(session);

  const personId = String(formData.get("personId") ?? "");
  if (!personId) redirect(path);

  const languages = COMMON_SPOKEN_LANGUAGES.filter((code) => formData.get(`language_${code}`));
  const saved = await setStaffLanguages(await getDb(), {
    shopId: session.user.shopId,
    personId,
    languages: [...languages],
  });
  revalidateAndRedirect(
    path,
    noticeUrl(`${path}#staff-${personId}`, saved ? "languages-saved" : "not_found", {
      languagesFor: personId,
    }),
  );
}

export async function setStaffStatusAction(formData: FormData) {
  const session = await requireStaffSession();
  const path = teamPath(session.user.shopSlug);
  await teamManagementBlock(session);

  const personId = String(formData.get("personId") ?? "");
  const userAccountId = String(formData.get("userAccountId") ?? "");
  const status = formData.get("status") === "active" ? "active" : "disabled";
  if (!personId || !userAccountId) redirect(path);

  const result = await setStaffAccountStatus(await getDb(), {
    shopId: session.user.shopId,
    personId,
    userAccountId,
    status,
  });
  const notice = result.ok ? (status === "active" ? "reactivated" : "disabled") : result.reason;
  revalidateAndRedirect(path, noticeUrl(path, notice));
}

export async function removeStaffAction(formData: FormData) {
  const session = await requireStaffSession();
  const path = teamPath(session.user.shopSlug);
  await teamManagementBlock(session);

  const personId = String(formData.get("personId") ?? "");
  const userAccountId = String(formData.get("userAccountId") ?? "");
  const fullName = String(formData.get("fullName") ?? "");
  if (!personId || !userAccountId) redirect(path);

  const db = await getDb();
  // Snapshotted before the strip below — a land-then-undo toast needs it to
  // hand back to `setStaffRoles` on restore (principle 7: stripping roles is
  // a purely reversible edit, not a send or a money-mover, so it gets an
  // Undo banner rather than a blocking confirm).
  const roles = await getStaffRoles(db, session.user.shopId, personId);
  const result = await removeStaffMember(db, {
    shopId: session.user.shopId,
    personId,
    userAccountId,
  });
  if (!result.ok) {
    revalidateAndRedirect(path, noticeUrl(path, result.reason));
    return;
  }
  // Their calendar subscription dies on its next fetch regardless —
  // `verifyCalendarFeed` re-derives roles every time — but leaving the row
  // live means the shop cannot see it is gone. Revoke it now so "removed
  // from the team" means removed everywhere it is visible. Restoring roles
  // via undo does not re-issue the old feed link; re-deriving from live
  // roles on the next fetch is enough to let them subscribe again if needed.
  //
  // This coordination lives here, not in `removeStaffMember`: `src/db` may
  // not import a feature module (ADR 20260730-feature-module-contracts), so
  // the composition layer is where two features meet.
  await revokeFeedsForFormerStaff(db, { shopId: session.user.shopId });
  revalidateAndRedirect(
    path,
    noticeUrl(path, "removed", {
      undoPersonId: personId,
      undoUserAccountId: userAccountId,
      undoRoles: roles.join(","),
      undoName: fullName,
    }),
  );
}

export async function restoreStaffAction(formData: FormData) {
  const session = await requireStaffSession();
  const path = teamPath(session.user.shopSlug);
  await teamManagementBlock(session);

  const personId = String(formData.get("personId") ?? "");
  const userAccountId = String(formData.get("userAccountId") ?? "");
  const roles = String(formData.get("roles") ?? "")
    .split(",")
    .filter((value): value is Role => (STAFF_ROLES as readonly string[]).includes(value));
  if (!personId || !userAccountId || roles.length === 0) redirect(path);

  const db = await getDb();
  const rolesResult = await setStaffRoles(db, { shopId: session.user.shopId, personId, roles });
  const statusResult = await setStaffAccountStatus(db, {
    shopId: session.user.shopId,
    personId,
    userAccountId,
    status: "active",
  });
  const notice = rolesResult.ok && statusResult.ok ? "restored" : "restore-failed";
  revalidateAndRedirect(path, noticeUrl(path, notice));
}
