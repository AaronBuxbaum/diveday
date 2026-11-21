import { getDb } from "@/db/client";
import {
  configuredWalletPlatforms,
  walletDepartureResponse,
} from "@/features/boarding/wallet-pass";
import { connectionForRoute } from "@/features/platform/render-connection";

export async function GET(request: Request, { params }: { params: Promise<{ token: string }> }) {
  await connectionForRoute("/ready/[token]/wallet/apple");
  if (!configuredWalletPlatforms().includes("apple")) return new Response(null, { status: 404 });
  return walletDepartureResponse(await getDb(), request, (await params).token, "apple");
}
