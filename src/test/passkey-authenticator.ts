import { createHash, generateKeyPairSync, randomBytes, sign } from "node:crypto";
import type { AuthenticationResponseJSON, RegistrationResponseJSON } from "@simplewebauthn/server";

/** Test-only P-256 authenticator. Assertions go through the real WebAuthn verifier. */
export function passkeyAuthenticator() {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const jwk = publicKey.export({ format: "jwk" });
  const id = randomBytes(32);
  const cose = Buffer.concat([
    Buffer.from("a5010203262001215820", "hex"),
    Buffer.from(jwk.x as string, "base64url"),
    Buffer.from("225820", "hex"),
    Buffer.from(jwk.y as string, "base64url"),
  ]);
  function client(challenge: string, origin: string, type: string) {
    return Buffer.from(JSON.stringify({ type, challenge, origin, crossOrigin: false }));
  }
  function data(rpId: string, flags: number, counter: number) {
    const count = Buffer.alloc(4);
    count.writeUInt32BE(counter);
    return Buffer.concat([createHash("sha256").update(rpId).digest(), Buffer.from([flags]), count]);
  }
  return {
    id: id.toString("base64url"),
    register(challenge: string, origin: string, rpId: string, uv = true): RegistrationResponseJSON {
      const length = Buffer.alloc(2);
      length.writeUInt16BE(id.length);
      const authData = Buffer.concat([
        data(rpId, uv ? 0x45 : 0x41, 0),
        Buffer.alloc(16),
        length,
        id,
        cose,
      ]);
      const attestation = Buffer.concat([
        Buffer.from("a363666d74646e6f6e656761747453746d74a068617574684461746158", "hex"),
        Buffer.from([authData.length]),
        authData,
      ]);
      return {
        id: id.toString("base64url"),
        rawId: id.toString("base64url"),
        type: "public-key",
        response: {
          clientDataJSON: client(challenge, origin, "webauthn.create").toString("base64url"),
          attestationObject: attestation.toString("base64url"),
        },
        clientExtensionResults: {},
      };
    },
    authenticate(
      challenge: string,
      origin: string,
      rpId: string,
      counter = 1,
      uv = true,
      userHandle?: string,
    ): AuthenticationResponseJSON {
      const clientData = client(challenge, origin, "webauthn.get");
      const authData = data(rpId, uv ? 0x05 : 0x01, counter);
      const signature = sign(
        "sha256",
        Buffer.concat([authData, createHash("sha256").update(clientData).digest()]),
        privateKey,
      );
      return {
        id: id.toString("base64url"),
        rawId: id.toString("base64url"),
        type: "public-key",
        response: {
          clientDataJSON: clientData.toString("base64url"),
          authenticatorData: authData.toString("base64url"),
          signature: signature.toString("base64url"),
          userHandle,
        },
        clientExtensionResults: {},
      };
    },
  };
}
