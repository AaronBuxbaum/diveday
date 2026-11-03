import type { AppDb } from "./client";
import { getShopWhatsAppAccount } from "./whatsapp-accounts";

export { canPersonManageMessagingSettings } from "./authz";

/** The WhatsApp settings page's question: the shop's completed connection, if any. */
export async function getWhatsAppSettingsPage(db: AppDb, shopId: string) {
  return { account: await getShopWhatsAppAccount(db, shopId) };
}
