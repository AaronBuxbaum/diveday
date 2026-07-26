"use server";

import { redirect } from "next/navigation";
import { after } from "next/server";
import { z } from "zod";
import { issueAccountToken } from "@/db/account-tokens";
import { canPersonManageStaffAccounts } from "@/db/authz";
import { getDb } from "@/db/client";
import { getShopById } from "@/db/shops";
import {
  inviteStaffMember,
  listShopStaff,
  removeStaffMember,
  setStaffAccountStatus,
  setStaffRoles,
} from "@/db/staff-accounts";
import { inviteLinkPath } from "@/lib/account-tokens";
import { type Role, STAFF_ROLE_LABELS, STAFF_ROLES } from "@/lib/authz";
import { revalidateAndRedirect } from "@/lib/navigation";
import { notify, publicAppUrl } from "@/lib/notifications";
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

const inviteSchema = z.object({
  fullName: z.string().trim().min(1, "Name is required").max(120),
  email: z.string().trim().toLowerCase().email("Invalid email address").max(150),
});

/** Sends a staff invite email deferred past the response, matching onboardAction's pattern. */
async function sendInviteEmail(input: {
  userAccountId: string;
  shopId: string;
  shopName: string;
  to: string;
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
  }).catch(() => null);
  if (!issued) return;
  after(async () => {
    await notify({
      kind: "staff_invite",
      userAccountId: input.userAccountId,
      tokenId: issued.tokenId,
      shopId: input.shopId,
      to: input.to,
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
    const notice =
      result.reason === "already_on_team" ? "invite_already_on_team" : "invite_email_taken";
    redirect(`${path}?notice=${notice}`);
  }

  await sendInviteEmail({
    userAccountId: result.userAccountId,
    shopId: session.user.shopId,
    shopName: shop.name,
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
  if (!member || member.accountStatus !== "invited") redirect(path);

  const db = await getDb();
  const shop = await getShopById(db, session.user.shopId);
  if (!shop) redirect(path);

  await sendInviteEmail({
    userAccountId: member.userAccountId,
    shopId: session.user.shopId,
    shopName: shop.name,
    to: member.email,
    inviteeName: member.fullName,
    inviterName: session.user.name ?? "A teammate",
    roles: member.roles,
    timezone: shop.timezone,
  });

  revalidateAndRedirect(path, `${path}?notice=invite_resent`);
}

export async function setStaffRolesAction(formData: FormData) {
  const session = await requireStaffSession();
  const path = `/shop/${session.user.shopSlug}${TEAM_PATH_SUFFIX}`;
  const blocked = await teamManagementBlock(session);
  if (blocked) redirect(blocked);

  const personId = String(formData.get("personId") ?? "");
  const roles = rolesFromFormData(formData);
  if (!personId || roles.length === 0) redirect(`${path}?notice=roles_invalid`);

  const result = await setStaffRoles(await getDb(), {
    shopId: session.user.shopId,
    personId,
    roles,
  });
  const notice = result.ok ? "roles_saved" : result.reason;
  revalidateAndRedirect(path, `${path}?notice=${notice}`);
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
  if (!personId || !userAccountId) redirect(path);

  const result = await removeStaffMember(await getDb(), {
    shopId: session.user.shopId,
    personId,
    userAccountId,
  });
  const notice = result.ok ? "removed" : result.reason;
  revalidateAndRedirect(path, `${path}?notice=${notice}`);
}
