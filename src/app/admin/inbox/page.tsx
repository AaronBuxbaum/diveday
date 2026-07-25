import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { z } from "zod";
import { EmptyState } from "@/components/EmptyState";
import { FlashParams } from "@/components/FlashParams";
import { ShopNotice, ShopPageHeader } from "@/components/ShopPageHeader";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { getDb } from "@/db/client";
import {
  countUnhandledInboundEmails,
  type InboundEmailView,
  listInboundEmails,
  setInboundEmailHandled,
} from "@/db/inbound-emails";
import { formatDateTimeTz } from "@/lib/format";
import { revalidateAndRedirect } from "@/lib/navigation";
import { requirePlatformSession } from "@/lib/session";

export const metadata: Metadata = {
  title: "Inbox — DiveDay",
};

const handledSchema = z.object({
  inboundEmailId: z.uuid(),
  handled: z.enum(["true", "false"]),
});

/**
 * A received message, as the operator reads it.
 *
 * The body is printed as text inside a `whitespace-pre-wrap` block and never
 * as markup — anyone on the internet can email these addresses, and this is
 * the surface their words land on. Ingest stores only the plain-text part for
 * the same reason (docs ADR 20260724-resend-webhook-email-events).
 */
function MessageCard({
  message,
  onToggle,
}: {
  message: InboundEmailView;
  onToggle: (formData: FormData) => Promise<void>;
}) {
  const handled = message.handledAt !== null;
  return (
    <li className="rounded-2xl border border-border bg-surface p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="font-semibold">{message.fromName ?? message.fromEmail}</p>
          <p className="text-sm text-muted">
            {message.fromName ? `${message.fromEmail} · ` : ""}
            {formatDateTimeTz(message.receivedAt, "en-US", "UTC")}
          </p>
          <p className="mt-1 text-sm">
            {message.mailboxAddress ? (
              <span className="text-muted">to {message.mailboxAddress}</span>
            ) : (
              <span className="text-warning">
                to {message.toEmail || "an unreadable address"} — no mailbox claims this address
              </span>
            )}
          </p>
        </div>
        <form action={onToggle} className="shrink-0">
          <input type="hidden" name="inboundEmailId" value={message.id} />
          <input type="hidden" name="handled" value={handled ? "false" : "true"} />
          <SubmitButton
            pendingLabel={handled ? "Reopening…" : "Marking…"}
            className={buttonClass({ variant: handled ? "ghost" : "secondary", size: "sm" })}
          >
            {handled ? "Reopen" : "Mark handled"}
          </SubmitButton>
        </form>
      </div>

      {message.subject ? <p className="mt-4 font-medium">{message.subject}</p> : null}
      <p className="mt-2 whitespace-pre-wrap text-sm text-muted">
        {message.textBody.trim() || "This message arrived without any readable text."}
      </p>
      {message.hasAttachments ? (
        <p className="mt-3 text-sm text-muted">
          The sender attached a file. DiveDay doesn’t store attachments — open it in Resend.
        </p>
      ) : null}
    </li>
  );
}

export default async function AdminInboxPage({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string; show?: string }>;
}) {
  const { access, db } = await requirePlatformSession();
  const { notice, show } = await searchParams;

  const includeHandled = show === "all";
  const messages = await listInboundEmails(db, access, { includeHandled });
  const waiting = await countUnhandledInboundEmails(db, access);

  async function toggleHandledAction(formData: FormData) {
    "use server";
    // Re-resolved rather than closed over: access is a live database fact, and
    // a form submitted minutes later must not act on a stale copy of it.
    const context = await requirePlatformSession();
    const parsed = handledSchema.safeParse(Object.fromEntries(formData));
    if (!parsed.success) redirect("/admin/inbox?notice=invalid");
    await setInboundEmailHandled(await getDb(), {
      access: context.access,
      inboundEmailId: parsed.data.inboundEmailId,
      handled: parsed.data.handled === "true",
      byPersonId: context.session.user.personId,
    });
    revalidateAndRedirect("/admin/inbox", "/admin/inbox");
  }

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <FlashParams params={["notice"]} />
      <ShopPageHeader
        eyebrow="DiveDay"
        title="Inbox"
        description="Mail sent to your own addresses — what people write in about before they're anyone's customer."
        meta={
          waiting > 0 ? (
            <p className="text-sm font-medium text-primary">
              {waiting === 1 ? "1 message waiting" : `${waiting} messages waiting`}
            </p>
          ) : undefined
        }
        actions={
          <Link
            href={`/admin/inbox${includeHandled ? "" : "?show=all"}`}
            className={buttonClass({ variant: "secondary", size: "sm" })}
          >
            {includeHandled ? "Show waiting only" : "Show handled too"}
          </Link>
        }
      />

      {notice === "invalid" ? (
        <div className="mb-6">
          <ShopNotice tone="danger" role="alert">
            That message couldn’t be updated. Try again.
          </ShopNotice>
        </div>
      ) : null}

      {messages.length === 0 ? (
        <EmptyState>
          <p className="font-medium">
            {includeHandled ? "No mail yet." : "Nothing waiting on you."}
          </p>
          <p className="mt-1 text-sm text-muted">
            {includeHandled
              ? "Mail sent to your DiveDay addresses shows up here."
              : "Every message has been handled."}
          </p>
        </EmptyState>
      ) : (
        <ul className="flex flex-col gap-4">
          {messages.map((message) => (
            <MessageCard key={message.id} message={message} onToggle={toggleHandledAction} />
          ))}
        </ul>
      )}
    </main>
  );
}
