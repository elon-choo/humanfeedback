"use client";

export const SECRET_ENCRYPTION_ALGORITHM =
  "ecdh-p256-hkdf-sha256-aes256gcm" as const;

const HKDF_INFO = "humanfeedback-secret-v1";

export interface EncryptedSecret {
  id: string;
  alg: typeof SECRET_ENCRYPTION_ALGORITHM;
  ephemeralPubKey: string;
  iv: string;
  ciphertext: string;
  aad: string;
}

export interface EncryptSecretInput {
  id: string;
  plaintext: string;
  recipientPubKey: string;
  slug: string;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";

  for (let index = 0; index < bytes.length; index += 1) {
    binary += String.fromCharCode(bytes[index]);
  }

  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value.trim());
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
}

/**
 * Encrypts one secret entirely in the browser for the request recipient.
 * Only public metadata and ciphertext are returned.
 */
export async function encryptSecret({
  id,
  plaintext,
  recipientPubKey,
  slug,
}: EncryptSecretInput): Promise<EncryptedSecret> {
  if (!globalThis.crypto?.subtle) {
    throw new Error("이 브라우저에서는 안전한 암호화를 사용할 수 없습니다.");
  }

  const recipientRaw = base64ToBytes(recipientPubKey);
  if (recipientRaw.length !== 65 || recipientRaw[0] !== 0x04) {
    recipientRaw.fill(0);
    throw new Error("수신자 공개 키 형식이 올바르지 않습니다.");
  }

  const encoder = new TextEncoder();
  const plaintextBytes = encoder.encode(plaintext);
  // Strings are immutable and cannot be wiped, so release this local binding
  // immediately; the mutable UTF-8 copy is cleared in the finally block.
  plaintext = "";
  const hkdfInfo = encoder.encode(HKDF_INFO);
  const emptySalt = new Uint8Array(0);
  const aad = `${slug}:${id}`;
  const aadBytes = encoder.encode(aad);
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));

  let sharedSecret: Uint8Array<ArrayBuffer> | undefined;
  let aesKeyBytes: Uint8Array<ArrayBuffer> | undefined;
  let ephemeralPublicRaw: Uint8Array<ArrayBuffer> | undefined;
  let encryptedBytes: Uint8Array<ArrayBuffer> | undefined;

  try {
    const recipientKey = await globalThis.crypto.subtle.importKey(
      "raw",
      recipientRaw,
      { name: "ECDH", namedCurve: "P-256" },
      false,
      [],
    );
    const ephemeralKeys = (await globalThis.crypto.subtle.generateKey(
      { name: "ECDH", namedCurve: "P-256" },
      true,
      ["deriveBits"],
    )) as CryptoKeyPair;

    ephemeralPublicRaw = new Uint8Array(
      await globalThis.crypto.subtle.exportKey("raw", ephemeralKeys.publicKey),
    );
    sharedSecret = new Uint8Array(
      await globalThis.crypto.subtle.deriveBits(
        { name: "ECDH", public: recipientKey },
        ephemeralKeys.privateKey,
        256,
      ),
    );

    const hkdfKey = await globalThis.crypto.subtle.importKey(
      "raw",
      sharedSecret,
      "HKDF",
      false,
      ["deriveBits"],
    );
    aesKeyBytes = new Uint8Array(
      await globalThis.crypto.subtle.deriveBits(
        {
          name: "HKDF",
          hash: "SHA-256",
          salt: emptySalt,
          info: hkdfInfo,
        },
        hkdfKey,
        256,
      ),
    );
    const aesKey = await globalThis.crypto.subtle.importKey(
      "raw",
      aesKeyBytes,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt"],
    );
    encryptedBytes = new Uint8Array(
      await globalThis.crypto.subtle.encrypt(
        {
          name: "AES-GCM",
          iv,
          additionalData: aadBytes,
          tagLength: 128,
        },
        aesKey,
        plaintextBytes,
      ),
    );

    return {
      id,
      alg: SECRET_ENCRYPTION_ALGORITHM,
      ephemeralPubKey: bytesToBase64(ephemeralPublicRaw),
      iv: bytesToBase64(iv),
      ciphertext: bytesToBase64(encryptedBytes),
      aad,
    };
  } finally {
    // JavaScript strings cannot be zeroized, but all mutable byte copies are
    // cleared as soon as encryption completes (successfully or otherwise).
    recipientRaw.fill(0);
    plaintextBytes.fill(0);
    hkdfInfo.fill(0);
    aadBytes.fill(0);
    sharedSecret?.fill(0);
    aesKeyBytes?.fill(0);
    ephemeralPublicRaw?.fill(0);
    encryptedBytes?.fill(0);
  }
}
