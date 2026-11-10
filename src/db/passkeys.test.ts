import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { hasRequiredStepUp } from "@/features/step-up/store";
import { createAuth } from "@/lib/auth";
import { nowDate, nowMs } from "@/lib/clock";
import { passkeyRelyingParty } from "@/lib/passkeys";
import { hashPassword } from "@/lib/password-hashing";
import { totpCode } from "@/lib/totp";
import { advanceClock } from "@/test/clock";
import { fileScopedShopContext } from "@/test/db";
import { passkeyAuthenticator } from "@/test/passkey-authenticator";
import { beginTotpEnrollment, enableTotp, hasStepUp } from "./account-security";
import type { AppTransaction } from "./client";
import type { VerifiedUser } from "./credentials";
import { DEV_STAFF_LOGINS } from "./dev-credentials";
import {
  authorizeFactorManagementPassword,
  beginPasskeyAuthentication,
  beginPasskeyRegistration,
  beginProtectedTotpEnrollment,
  enableProtectedTotp,
  listAccountPasskeys,
  registerAccountPasskey,
  renameAccountPasskey,
  revokeAccountPasskey,
  startPasskeySignIn,
  verifyPasskeyStepUp,
} from "./passkeys";
import {
  accountPasskeyChallenges,
  accountPasskeys,
  accountSessions,
  personRoles,
  userAccounts,
} from "./schema";

const ctx = fileScopedShopContext();
const rp = { origin: "https://diveday.app", rpId: "diveday.app" };
async function persist(tx: AppTransaction, user: VerifiedUser) {
  const provider = await createAuth(tx).$context;
  const session = await provider.internalAdapter.createSession(user.id, false, {
    personId: user.personId,
    shopId: user.shopId,
    shopSlug: user.shopSlug,
    roles: user.roles,
    name: user.name,
  });
  if (!session) throw new Error("session failed");
  return session;
}
async function fixture() {
  const { db, shop } = ctx;
  const [account] = await db
    .select()
    .from(userAccounts)
    .where(eq(userAccounts.email, DEV_STAFF_LOGINS.owner.email));
  const [session] = await db
    .insert(accountSessions)
    .values({
      userAccountId: account.id,
      personId: account.personId,
      shopId: shop.id,
      shopSlug: shop.slug,
      roles: ["owner"],
      name: "Owner",
      token: randomUUID(),
      expiresAt: new Date(nowMs() + 86400000),
    })
    .returning();
  const binding = { userAccountId: account.id, accountSessionId: session.id, shopId: shop.id };
  const authenticator = passkeyAuthenticator();
  const start = await beginPasskeyRegistration(db, binding, rp, null);
  if (!start) throw new Error("registration unavailable");
  const register = () =>
    registerAccountPasskey(
      db,
      binding,
      rp,
      start.handle,
      authenticator.register(start.options.challenge, rp.origin, rp.rpId),
      "My phone",
    );
  const signIn = async (
    overrides: {
      origin?: string;
      rpId?: string;
      uv?: boolean;
      counter?: number;
      userHandle?: string;
    } = {},
  ) => {
    const attempt = await beginPasskeyAuthentication(db, rp, null);
    const response = authenticator.authenticate(
      attempt.options.challenge,
      overrides.origin ?? rp.origin,
      overrides.rpId ?? rp.rpId,
      overrides.counter ?? 1,
      overrides.uv ?? true,
      overrides.userHandle,
    );
    return {
      attempt,
      response,
      finish: () => startPasskeySignIn(db, rp, attempt.handle, response, null, persist),
    };
  };
  const prove = async () => {
    const attempt = await beginPasskeyAuthentication(db, rp, null, binding, "security");
    expect(
      await verifyPasskeyStepUp(
        db,
        binding,
        "security",
        rp,
        attempt.handle,
        authenticator.authenticate(attempt.options.challenge, rp.origin, rp.rpId, 0),
      ),
    ).toBe(true);
  };
  return { db, shop, account, binding, authenticator, start, register, signIn, prove };
}

describe("staff passkeys", () => {
  it("refuses a new UV key when TOTP already protects the session and no existing proof was supplied", async () => {
    const h = await fixture();
    const enrollment = await beginTotpEnrollment(h.db, h.account.id);
    if (!enrollment) throw new Error("enrollment failed");
    expect(await enableTotp(h.db, h.account.id, totpCode(enrollment.secret))).toBe(true);
    expect(await h.register()).toBe(false);
    expect(await listAccountPasskeys(h.db, h.account.id, h.shop.id)).toEqual([]);
  });
  it("refuses removing the last passkey with session possession alone", async () => {
    const h = await fixture();
    expect(await h.register()).toBe(true);
    const [key] = await listAccountPasskeys(h.db, h.account.id, h.shop.id);
    expect(await revokeAccountPasskey(h.db, h.binding, key.id)).toBe(false);
    expect(await listAccountPasskeys(h.db, h.account.id, h.shop.id)).toHaveLength(1);
  });
  it("accepts a current password for lost-device recovery without granting money or export", async () => {
    const h = await fixture();
    await h.register();
    await h.db
      .update(userAccounts)
      .set({ hashedPassword: await hashPassword("Known recovery password 2026!") })
      .where(eq(userAccounts.id, h.account.id));
    expect(await authorizeFactorManagementPassword(h.db, h.binding, "wrong-password")).toBe(false);
    expect(
      await authorizeFactorManagementPassword(
        h.db,
        { ...h.binding, accountSessionId: randomUUID() },
        "Known recovery password 2026!",
      ),
    ).toBe(false);
    expect(
      await authorizeFactorManagementPassword(h.db, h.binding, "Known recovery password 2026!"),
    ).toBe(true);
    expect(await hasStepUp(h.db, { ...h.binding, purpose: "money" })).toBe(false);
    expect(await hasStepUp(h.db, { ...h.binding, purpose: "export" })).toBe(false);
    const [key] = await listAccountPasskeys(h.db, h.account.id, h.shop.id);
    expect(await revokeAccountPasskey(h.db, h.binding, key.id)).toBe(true);
  });
  it("uses an existing UV key for alternate-factor enrollment and expires that proof after five minutes", async () => {
    const h = await fixture();
    await h.register();
    expect((await beginProtectedTotpEnrollment(h.db, h.binding)).status).toBe("proof_required");
    await h.prove();
    const started = await beginProtectedTotpEnrollment(h.db, h.binding);
    expect(started.status).toBe("started");
    if (started.status !== "started") throw new Error("missing enrollment");
    advanceClock(300001);
    expect((await enableProtectedTotp(h.db, h.binding, totpCode(started.secret))).status).toBe(
      "proof_required",
    );
    await h.prove();
    expect(await enableProtectedTotp(h.db, h.binding, totpCode(started.secret))).toEqual({
      status: "checked",
      enabled: true,
    });
  });
  it("does not accept a grant for money as authorization to change factors", async () => {
    const h = await fixture();
    await h.register();
    const attempt = await beginPasskeyAuthentication(h.db, rp, null, h.binding, "money");
    expect(
      await verifyPasskeyStepUp(
        h.db,
        h.binding,
        "money",
        rp,
        attempt.handle,
        h.authenticator.authenticate(attempt.options.challenge, rp.origin, rp.rpId),
      ),
    ).toBe(true);
    expect(await beginPasskeyRegistration(h.db, h.binding, rp, null)).toBeNull();
    const [key] = await listAccountPasskeys(h.db, h.account.id, h.shop.id);
    expect(await revokeAccountPasskey(h.db, h.binding, key.id)).toBe(false);
  });
  it("binds only exact configured origins and permits loopback development", () => {
    expect(passkeyRelyingParty([rp.origin], rp.origin)).toEqual(rp);
    for (const origin of [
      null,
      "https://evil.example",
      "https://diveday.app.evil.example",
      "https://diveday.app/",
    ])
      expect(passkeyRelyingParty([rp.origin], origin)).toBeNull();
    expect(passkeyRelyingParty(["http://localhost:3000"], "http://localhost:3000")).toEqual({
      origin: "http://localhost:3000",
      rpId: "localhost",
    });
    expect(passkeyRelyingParty(["http://diveday.app"], "http://diveday.app")).toBeNull();
  });
  it("registers a UV resident credential, lists only public metadata, renames and soft deletes it", async () => {
    const h = await fixture();
    expect(h.start.options.authenticatorSelection).toMatchObject({
      residentKey: "required",
      userVerification: "required",
    });
    expect(await h.register()).toBe(true);
    const [key] = await listAccountPasskeys(h.db, h.account.id, h.shop.id);
    expect(Object.keys(key).sort()).toEqual(["createdAt", "id", "lastUsedAt", "name"]);
    expect(await renameAccountPasskey(h.db, h.binding, key.id, "Office key")).toBe(true);
    expect((await listAccountPasskeys(h.db, h.account.id, h.shop.id))[0].name).toBe("Office key");
    await h.prove();
    expect(await revokeAccountPasskey(h.db, h.binding, key.id)).toBe(true);
    expect(await listAccountPasskeys(h.db, h.account.id, h.shop.id)).toEqual([]);
    expect((await h.db.select().from(accountPasskeys))[0].deletedAt).not.toBeNull();
  });
  it.each(["origin", "rp", "uv", "expired", "session", "user", "shop"])(
    "rejects registration with a wrong %s",
    async (fault) => {
      const h = await fixture();
      if (fault === "expired") advanceClock(300001);
      const binding = {
        ...h.binding,
        ...(fault === "session" ? { accountSessionId: randomUUID() } : {}),
        ...(fault === "user" ? { userAccountId: randomUUID() } : {}),
        ...(fault === "shop" ? { shopId: randomUUID() } : {}),
      };
      const response = h.authenticator.register(
        h.start.options.challenge,
        fault === "origin" ? "https://evil.example" : rp.origin,
        fault === "rp" ? "evil.example" : rp.rpId,
        fault !== "uv",
      );
      expect(
        await registerAccountPasskey(h.db, binding, rp, h.start.handle, response, "Phone"),
      ).toBe(false);
      expect(await listAccountPasskeys(h.db, h.account.id, h.shop.id)).toEqual([]);
    },
  );
  it("spends registration once and refuses a browser without its handle", async () => {
    const h = await fixture();
    expect(
      await registerAccountPasskey(
        h.db,
        h.binding,
        rp,
        null,
        h.authenticator.register(h.start.options.challenge, rp.origin, rp.rpId),
        "Phone",
      ),
    ).toBe(false);
    expect(await h.register()).toBe(true);
    expect(await h.register()).toBe(false);
  });
  it("signs in with the real verifier and same Better Auth session issuer; replay is refused", async () => {
    const h = await fixture();
    expect(await h.register()).toBe(true);
    const attempt = await h.signIn();
    const signedIn = await attempt.finish();
    expect(signedIn.status).toBe("signed_in");
    if (signedIn.status === "signed_in")
      expect(signedIn.value).toMatchObject({ userId: h.account.id, shopId: h.shop.id });
    expect((await attempt.finish()).status).toBe("invalid");
    expect((await listAccountPasskeys(h.db, h.account.id, h.shop.id))[0].lastUsedAt).toEqual(
      nowDate(),
    );
  });
  it.each([
    { origin: "https://evil.example" },
    { rpId: "evil.example" },
    { uv: false },
    { userHandle: "d3Jvbmc" },
  ])("refuses a signed assertion with wrong binding %j", async (fault) => {
    const h = await fixture();
    expect(await h.register()).toBe(true);
    expect((await (await h.signIn(fault)).finish()).status).toBe("invalid");
  });
  it("expires challenges and rejects regressed signature counters", async () => {
    const h = await fixture();
    await h.register();
    const expired = await h.signIn();
    advanceClock(300001);
    expect((await expired.finish()).status).toBe("invalid");
    expect((await (await h.signIn({ counter: 2 })).finish()).status).toBe("signed_in");
    expect((await (await h.signIn({ counter: 1 })).finish()).status).toBe("invalid");
  });
  it("keeps enabled TOTP as a second sign-in stage and issues no session", async () => {
    const h = await fixture();
    await h.register();
    const enrollment = await beginTotpEnrollment(h.db, h.account.id);
    if (!enrollment) throw new Error("enrollment failed");
    expect(await enableTotp(h.db, h.account.id, totpCode(enrollment.secret))).toBe(true);
    const before = await h.db.select().from(accountSessions);
    expect((await (await h.signIn()).finish()).status).toBe("pending");
    expect(await h.db.select().from(accountSessions)).toHaveLength(before.length);
  });
  it("rejects a removed key and a staff account demoted after issuing its options", async () => {
    const h = await fixture();
    await h.register();
    const attempt = await h.signIn();
    await h.db.delete(personRoles).where(eq(personRoles.personId, h.account.personId));
    expect((await attempt.finish()).status).toBe("invalid");
  });
  it("refuses revoked credentials even when their signed assertion was already prepared", async () => {
    const h = await fixture();
    await h.register();
    const attempt = await h.signIn();
    const [key] = await listAccountPasskeys(h.db, h.account.id, h.shop.id);
    await h.prove();
    await revokeAccountPasskey(h.db, h.binding, key.id);
    expect((await attempt.finish()).status).toBe("invalid");
  });
  it.each(["purpose", "session", "user", "revoked", "expired"])(
    "binds fresh step-up to its %s",
    async (fault) => {
      const h = await fixture();
      await h.register();
      const attempt = await beginPasskeyAuthentication(h.db, rp, null, h.binding, "money");
      const binding = {
        ...h.binding,
        ...(fault === "session" ? { accountSessionId: randomUUID() } : {}),
        ...(fault === "user" ? { userAccountId: randomUUID() } : {}),
      };
      if (fault === "revoked")
        await h.db
          .delete(accountSessions)
          .where(eq(accountSessions.id, h.binding.accountSessionId));
      if (fault === "expired") advanceClock(300001);
      expect(
        await verifyPasskeyStepUp(
          h.db,
          binding,
          fault === "purpose" ? "export" : "money",
          rp,
          attempt.handle,
          h.authenticator.authenticate(attempt.options.challenge, rp.origin, rp.rpId),
        ),
      ).toBe(false);
      expect(await hasStepUp(h.db, { ...h.binding, purpose: "money" })).toBe(false);
    },
  );
  it("requires step-up for passkey holders and grants only the requested purpose on the existing session", async () => {
    const h = await fixture();
    await h.register();
    const session = {
      user: {
        userAccountId: h.account.id,
        sessionId: h.binding.accountSessionId,
        personId: h.account.personId,
        shopId: h.shop.id,
        shopSlug: h.shop.slug,
        name: "Owner",
        email: h.account.email,
        roles: ["owner" as const],
      },
    };
    expect(await hasRequiredStepUp(h.db, session, "money")).toBe(false);
    const attempt = await beginPasskeyAuthentication(h.db, rp, null, h.binding, "money");
    const response = h.authenticator.authenticate(attempt.options.challenge, rp.origin, rp.rpId);
    expect(await verifyPasskeyStepUp(h.db, h.binding, "money", rp, attempt.handle, response)).toBe(
      true,
    );
    expect(await hasRequiredStepUp(h.db, session, "money")).toBe(true);
    expect(await hasRequiredStepUp(h.db, session, "export")).toBe(false);
    expect(await h.db.select().from(accountSessions)).toHaveLength(1);
    expect(await verifyPasskeyStepUp(h.db, h.binding, "money", rp, attempt.handle, response)).toBe(
      false,
    );
    expect(await h.db.select().from(accountPasskeyChallenges)).toEqual([]);
  });
});
