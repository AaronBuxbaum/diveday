import { PKPass } from "passkit-generator";
import type { PassContent } from "@/lib/wallet-passes";
import { PASS_ICONS, WWDR_CERTIFICATE } from "./bundled-assets";
import { appleCredentials, walletOrigin } from "./config";
import { passAuthenticationToken } from "./rules";

export function applePassBytes(
  passId: string,
  content: PassContent,
  token = passAuthenticationToken(passId),
): Uint8Array {
  const credentials = appleCredentials();
  const origin = walletOrigin();
  if (!credentials || !origin) throw new Error("apple_wallet_unconfigured");
  const pass = new PKPass(
    {
      ...PASS_ICONS,
      "pass.json": Buffer.from(
        JSON.stringify({
          formatVersion: 1,
          passTypeIdentifier: credentials.passTypeIdentifier,
          teamIdentifier: credentials.teamIdentifier,
          serialNumber: passId,
          organizationName: content.shopName,
          description: content.description,
          logoText: content.shopName,
          webServiceURL: `${origin}/api/wallet`,
          authenticationToken: token,
          backgroundColor: content.backgroundColor,
          foregroundColor: content.foregroundColor,
          labelColor: content.foregroundColor,
          voided: content.voided,
          generic: {
            headerFields: content.headerFields,
            primaryFields: content.primaryFields,
            secondaryFields: content.secondaryFields,
            auxiliaryFields: content.auxiliaryFields,
            backFields: content.backFields,
          },
        }),
      ),
    },
    {
      wwdr: WWDR_CERTIFICATE,
      signerCert: credentials.signerCert,
      signerKey: credentials.signerKey,
      signerKeyPassphrase: credentials.signerKeyPassphrase,
    },
  );
  pass.setRelevantDate(new Date(content.relevantDate));
  pass.setExpirationDate(new Date(content.expirationDate));
  return new Uint8Array(pass.getAsBuffer());
}
