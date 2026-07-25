import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { z } from "zod";
import { EmptyState } from "@/components/EmptyState";
import { FlashParams } from "@/components/FlashParams";
import { ShopNotice, ShopPageHeader } from "@/components/ShopPageHeader";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { controlClass, Field, FieldGrid } from "@/components/ui/form";
import { getDb } from "@/db/client";
import {
  addPlatformMailboxMember,
  archivePlatformMailbox,
  createPlatformMailbox,
  listPlatformMailboxes,
  removePlatformMailboxMember,
} from "@/db/platform-mailboxes";
import { nowDate } from "@/lib/clock";
import { revalidateAndRedirect } from "@/lib/navigation";
import { platformAdminEmails } from "@/lib/platform-admin";
import { requirePlatformAdminSession } from "@/lib/session";

export const metadata: Metadata = {
  title: "Addresses — DiveDay",
};

const createSchema = z.object({
  address: z.email().max(200),
  label: z.string().trim().min(1).max(60),
});
const memberSchema = z.object({ mailboxId: z.uuid(), email: z.email().max(200) });
const removeMemberSchema = z.object({ mailboxId: z.uuid(), personId: z.uuid() });
const archiveSchema = z.object({ mailboxId: z.uuid() });

const NOTICES: Record<string, { text: string; error: boolean }> = {
  created: { text: "Address added. Mail sent to it lands in the inbox from now on.", error: false },
  duplicate: { text: "That address already has a mailbox.", error: true },
  invalid: { text: "That didn’t save. Check the address and try again.", error: true },
  member_added: { text: "They can read this mailbox now.", error: false },
  unknown_person: {
    text: "No active DiveDay login has that email. They need one before you can add them.",
    error: true,
  },
  member_removed: { text: "Removed. They can no longer read this mailbox.", error: false },
  archived: { text: "Address retired. Its mail stays, but nobody new can read it.", error: false },
};

export default async function AdminMailboxesPage({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string }>;
}) {
  const { db } = await requirePlatformAdminSession();
  const { notice } = await searchParams;
  const mailboxes = await listPlatformMailboxes(db);
  const admins = platformAdminEmails();

  async function createAction(formData: FormData) {
    "use server";
    await requirePlatformAdminSession();
    const parsed = createSchema.safeParse(Object.fromEntries(formData));
    if (!parsed.success) redirect("/admin/mailboxes?notice=invalid");
    const result = await createPlatformMailbox(await getDb(), parsed.data);
    revalidateAndRedirect(
      "/admin/mailboxes",
      `/admin/mailboxes?notice=${result.ok ? "created" : "duplicate"}`,
    );
  }

  async function addMemberAction(formData: FormData) {
    "use server";
    await requirePlatformAdminSession();
    const parsed = memberSchema.safeParse(Object.fromEntries(formData));
    if (!parsed.success) redirect("/admin/mailboxes?notice=invalid");
    const result = await addPlatformMailboxMember(await getDb(), parsed.data);
    revalidateAndRedirect(
      "/admin/mailboxes",
      `/admin/mailboxes?notice=${result.ok ? "member_added" : result.reason}`,
    );
  }

  async function removeMemberAction(formData: FormData) {
    "use server";
    await requirePlatformAdminSession();
    const parsed = removeMemberSchema.safeParse(Object.fromEntries(formData));
    if (!parsed.success) redirect("/admin/mailboxes?notice=invalid");
    await removePlatformMailboxMember(await getDb(), parsed.data);
    revalidateAndRedirect("/admin/mailboxes", "/admin/mailboxes?notice=member_removed");
  }

  async function archiveAction(formData: FormData) {
    "use server";
    await requirePlatformAdminSession();
    const parsed = archiveSchema.safeParse(Object.fromEntries(formData));
    if (!parsed.success) redirect("/admin/mailboxes?notice=invalid");
    await archivePlatformMailbox(await getDb(), parsed.data.mailboxId, nowDate());
    revalidateAndRedirect("/admin/mailboxes", "/admin/mailboxes?notice=archived");
  }

  const banner = notice ? NOTICES[notice] : undefined;

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <FlashParams params={["notice"]} />
      <ShopPageHeader
        eyebrow="DiveDay"
        title="Addresses"
        description="Your own role addresses and who reads each one. Mail to an address nobody claims still arrives — only you can see it."
        align="start"
      />

      {banner ? (
        <div className="mb-6">
          <ShopNotice
            tone={banner.error ? "danger" : "success"}
            role={banner.error ? "alert" : "status"}
          >
            {banner.text}
          </ShopNotice>
        </div>
      ) : null}

      <section>
        <h2 className="text-lg font-semibold">Add an address</h2>
        <p className="mt-1 text-sm text-muted">
          It has to be an address on a domain you’ve pointed at DiveDay. Mail to anything else never
          reaches us.
        </p>
        <form
          action={createAction}
          className="mt-4 flex flex-col gap-3 rounded-2xl border border-border bg-surface p-5 sm:flex-row sm:items-end"
        >
          <FieldGrid columns={2} className="flex-1">
            <Field label="Address">
              <input
                type="email"
                name="address"
                required
                maxLength={200}
                placeholder="legal@dive.day"
                className={controlClass}
              />
            </Field>
            <Field label="What it’s for">
              <input
                type="text"
                name="label"
                required
                maxLength={60}
                placeholder="Legal"
                className={controlClass}
              />
            </Field>
          </FieldGrid>
          <SubmitButton pendingLabel="Adding…" className={buttonClass()}>
            Add address
          </SubmitButton>
        </form>
      </section>

      <section className="mt-10">
        <h2 className="text-lg font-semibold">Your addresses</h2>
        {mailboxes.length === 0 ? (
          <EmptyState className="mt-4">
            <p className="font-medium">No addresses yet.</p>
            <p className="mt-1 text-sm text-muted">
              Add one above and its mail starts landing in the inbox.
            </p>
          </EmptyState>
        ) : (
          <ul className="mt-4 flex flex-col gap-4">
            {mailboxes.map((mailbox) => (
              <li key={mailbox.id} className="rounded-2xl border border-border bg-surface p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-semibold">{mailbox.address}</p>
                    <p className="text-sm text-muted">{mailbox.label}</p>
                  </div>
                  <form action={archiveAction}>
                    <input type="hidden" name="mailboxId" value={mailbox.id} />
                    <SubmitButton
                      pendingLabel="Retiring…"
                      className={buttonClass({ variant: "ghost", size: "sm" })}
                    >
                      Retire
                    </SubmitButton>
                  </form>
                </div>

                <p className="mt-4 text-sm font-medium">Who reads it</p>
                {mailbox.members.length === 0 ? (
                  <p className="mt-1 text-sm text-muted">
                    Nobody yet — only you, as an operator, can see this mail.
                  </p>
                ) : (
                  <ul className="mt-2 flex flex-col gap-2">
                    {mailbox.members.map((member) => (
                      <li
                        key={member.personId}
                        className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-surface-sunken px-3 py-2"
                      >
                        <span className="text-sm">
                          {member.fullName}
                          {member.email ? (
                            <span className="text-muted"> · {member.email}</span>
                          ) : null}
                        </span>
                        <form action={removeMemberAction}>
                          <input type="hidden" name="mailboxId" value={mailbox.id} />
                          <input type="hidden" name="personId" value={member.personId} />
                          <SubmitButton
                            pendingLabel="Removing…"
                            className={buttonClass({ variant: "ghost", size: "sm" })}
                          >
                            Remove
                          </SubmitButton>
                        </form>
                      </li>
                    ))}
                  </ul>
                )}

                <form
                  action={addMemberAction}
                  className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-end"
                >
                  <input type="hidden" name="mailboxId" value={mailbox.id} />
                  <FieldGrid columns={1} className="flex-1">
                    <Field label="Add a reader by email">
                      <input
                        type="email"
                        name="email"
                        required
                        maxLength={200}
                        placeholder="jo@example.com"
                        className={controlClass}
                      />
                    </Field>
                  </FieldGrid>
                  <SubmitButton
                    pendingLabel="Adding…"
                    className={buttonClass({ variant: "secondary" })}
                  >
                    Add reader
                  </SubmitButton>
                </form>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-10">
        <h2 className="text-lg font-semibold">Operators</h2>
        <p className="mt-1 text-sm text-muted">
          Operators read every address, including mail nobody claims, and are the only people who
          can change this page. Set in the deploy environment, not here.
        </p>
        {admins.length === 0 ? (
          <p className="mt-3 text-sm text-warning">
            None configured — nobody can reach these pages until PLATFORM_ADMIN_EMAILS is set.
          </p>
        ) : (
          <ul className="mt-3 flex flex-col gap-1 text-sm text-muted">
            {admins.map((email) => (
              <li key={email}>{email}</li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
