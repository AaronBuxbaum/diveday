import { getDb } from "@/db/client";
import {
  type AppleRouteParams,
  appleServiceResponse,
  configuredWalletPlatforms,
} from "@/features/wallet-pass";

export async function POST(request: Request, { params }: { params: Promise<AppleRouteParams> }) {
  if (!configuredWalletPlatforms().includes("apple")) return new Response(null, { status: 404 });
  return appleServiceResponse(await getDb(), request, await params, "register");
}
export async function DELETE(request: Request, { params }: { params: Promise<AppleRouteParams> }) {
  if (!configuredWalletPlatforms().includes("apple")) return new Response(null, { status: 404 });
  return appleServiceResponse(await getDb(), request, await params, "unregister");
}
