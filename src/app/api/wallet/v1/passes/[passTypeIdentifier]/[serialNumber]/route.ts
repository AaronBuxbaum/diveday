import { getDb } from "@/db/client";
import { connectionForRoute } from "@/features/render-connection";
import {
  type AppleRouteParams,
  appleServiceResponse,
  configuredWalletPlatforms,
} from "@/features/wallet-pass";

export async function GET(request: Request, { params }: { params: Promise<AppleRouteParams> }) {
  await connectionForRoute("/api/wallet/v1/passes/[passTypeIdentifier]/[serialNumber]");
  if (!configuredWalletPlatforms().includes("apple")) return new Response(null, { status: 404 });
  return appleServiceResponse(await getDb(), request, await params, "latest");
}
