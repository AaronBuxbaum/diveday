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
  type StaffMutationResult,
  setStaffAccountStatus,
  setStaffRoles,
} from "@/db/staff-accounts";
import { revokeFeedsForFormerStaff } from "@/features/calendar-sync";
import { toDiverLocale } from "@/i18n/settings";
import { inviteLinkPath } from "@/lib/account-tokens";
import { type Role, STAFF_ROLE_LABELS, STAFF_ROLES } from "@/lib/authz";
import { revalidateAndRedirect } from "@/lib/navigation";
import { publicAppUrl } from "@/lib/notifications";
import { requireStaffSession } from "@/lib/session";

const TEAM_PATH_SUFFIX = "/settings/team";

/** Returns the redirect target when the actor lacks the team gate, or null to proceed. */
async function teamManagementBlock(session: {
  user: { shopId: string; personId: string; shopSlug: string };
}): Promise<string | null> {
  const allowed = await canPersonManageStaffAccounts(
    await getDb(),
    session.user.shopId,
    session.user.personId,
  );
  return allowed ? null : `/shop/${session.user.shopSlug}${TEAM_PATH_SUFFIX}?notice=not_authorized`;
}

function rolesFromFormData(formData: FormData): Role[] {
  return STAFF_ROLES.filter((role) => formData.get(`role_${role}`) === "on");
}

// No message arguments. A Zod message is a sentence in the language whoever
// typed the schema happened to speak, and `pnpm check:copy` cannot see a string
// literal passed as a validator argument — so one lands in the UI untranslated
// the first time a caller renders `error.issues[].message`. This schema fails
// with issue codes; the page turns a refusal into a `?notice=invite_invalid`
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
  const path = `/shop/${session.user.shopSlug}${TEAM_PATH_SUFFIX}`;
  const blocked = await teamManagementBlock(session);
  if (blocked) redirect(blocked);

  const parsed = inviteSchema.safeParse(Object.fromEntries(formData));
  const roles = rolesFromFormData(formData);
  if (!parsed.success || roles.length === 0) {
    redirect(`${path}?notice=invite_invalid`);
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
      already_on_team: "invite_already_on_team",
      email_registered_elsewhere: "invite_email_taken",
      // The reserved demo namespace (ADR 20260803-demo-bypass-containment).
      email_reserved: "invite_email_reserved",
    }[result.reason];
    redirect(`${path}?notice=${notice}`);
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

  revalidateAndRedirect(path, `${path}?notice=invited`);
}

async function findTeamMember(shopId: string, userAccountId: string) {
  const staff = await listShopStaff(await getDb(), shopId);
  return staff.find((member) => member.userAccountId === userAccountId) ?? null;
}

export async function resendInviteAction(formData: FormData) {
  const session = await requireStaffSession();
  const path = `/shop/${session.user.shopSlug}${TEAM_PATH_SUFFIX}`;
  const blocked = await teamManagementBlock(session);
  if (blocked) redirect(blocked);

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

  revalidateAndRedirect(path, `${path}?notice=invite_resent`);
}

/**
 * Every staff card's role checkboxes are associated (via the HTML `form`
 * attribute, not DOM nesting) to one page-level form, named
 * `role_<personId>_<role>` per checkbox — see team/page.tsx. This is the
 * "Save changes" button at the bottom of the page: it walks the shop's whole
 * roster and applies each member's checked roles in one submit. Enable/
 * Disable/Delete are separate, immediate actions (setStaffStatusAction,
 * removeStaffAction below) — they never wait for this button.
 */
export async function saveAllStaffRolesAction(formData: FormData) {
  const session = await requireStaffSession();
  const path = `/shop/${session.user.shopSlug}${TEAM_PATH_SUFFIX}`;
  const blocked = await teamManagementBlock(session);
  if (blocked) redirect(blocked);

  const db = await getDb();
  const staff = await listShopStaff(db, session.user.shopId);

  // Validate every member's checked roles before writing any of them — a
  // save is all-or-nothing, so one blank row can't leave earlier rows
  // written but the redirect skipping revalidation (Sourcery review, PR 242).
  const memberRoles = staff.map((member) => ({
    member,
    roles: STAFF_ROLES.filter((role) => formData.get(`role_${member.personId}_${role}`) === "on"),
  }));
  if (memberRoles.some(({ roles }) => roles.length === 0)) {
    redirect(`${path}?notice=roles_invalid`);
  }

  let failureReason: Extract<StaffMutationResult, { ok: false }>["reason"] | null = null;
  for (const { member, roles } of memberRoles) {
    const result = await setStaffRoles(db, {
      shopId: session.user.shopId,
      personId: member.personId,
      roles,
    });
    if (!result.ok) failureReason = result.reason;
  }

  revalidateAndRedirect(path, `${path}?notice=${failureReason ?? "changes_saved"}`);
}

export async function setStaffStatusAction(formData: FormData) {
  const session = await requireStaffSession();
  const path = `/shop/${session.user.shopSlug}${TEAM_PATH_SUFFIX}`;
  const blocked = await teamManagementBlock(session);
  if (blocked) redirect(blocked);

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
  revalidateAndRedirect(path, `${path}?notice=${notice}`);
}

export async function removeStaffAction(formData: FormData) {
  const session = await requireStaffSession();
  const path = `/shop/${session.user.shopSlug}${TEAM_PATH_SUFFIX}`;
  const blocked = await teamManagementBlock(session);
  if (blocked) redirect(blocked);

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
    revalidateAndRedirect(path, `${path}?notice=${result.reason}`);
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
  const undoParams = new URLSearchParams({
    notice: "removed",
    undoPersonId: personId,
    undoUserAccountId: userAccountId,
    undoRoles: roles.join(","),
    undoName: fullName,
  });
  revalidateAndRedirect(path, `${path}?${undoParams.toString()}`);
}

export async function restoreStaffAction(formData: FormData) {
  const session = await requireStaffSession();
  const path = `/shop/${session.user.shopSlug}${TEAM_PATH_SUFFIX}`;
  const blocked = await teamManagementBlock(session);
  if (blocked) redirect(blocked);

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
  const notice = rolesResult.ok && statusResult.ok ? "restored" : "restore_failed";
  revalidateAndRedirect(path, `${path}?notice=${notice}`);
}
