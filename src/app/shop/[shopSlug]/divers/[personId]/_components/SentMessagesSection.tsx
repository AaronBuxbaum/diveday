import { InsetGroup } from "@/components/ui/ledger";
import type { SentMessage } from "@/db/person-sent-messages";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { formatDateTimeTz } from "@/lib/format";
import { DiverFileGroupDisclosure } from "./DiverFileGroupDisclosure";

/**
 * **What the shop sent this diver** (issue #3660): the confirmation, the
 * reminders, the recap and the rest, one line each, with how it landed. The
 * thread above holds what they wrote and what staff typed back; this is the
 * rest of the conversation, so "did we tell them?" is answered on the record.
 * Renders nothing for a diver the shop has sent nothing.
 *
 * What a provider reported (bounced, delayed, spam) wins over our own `sent`,
 * since it is the later fact about the same message.
 */
export function SentMessagesSection({
  messages,
  locale,
  timezone,
  t,
}: {
  messages: SentMessage[];
  locale: string;
  timezone: string;
  t: StaffTranslator;
}) {
  if (messages.length === 0) return null;
  return (
    <DiverFileGroupDisclosure
      id="sent-messages"
      label={t("divers.file.sentHeading")}
      summary={t("divers.file.sentSummary", { count: messages.length })}
    >
      <InsetGroup>
        {messages.map((message) => {
          const outcome =
            message.providerStatus && message.providerStatus !== "sent"
              ? message.providerStatus
              : message.status;
          return (
            <p key={message.id} className="px-5 py-3 text-sm sm:px-6">
              {t("divers.file.sentLine", {
                kind: t(`divers.file.sentKind.${message.kind}`),
                status: t(`divers.file.sentStatus.${outcome}`),
                date: formatDateTimeTz(message.attemptedAt, locale, timezone),
              })}
            </p>
          );
        })}
      </InsetGroup>
    </DiverFileGroupDisclosure>
  );
}
