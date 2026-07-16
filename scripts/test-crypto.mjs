import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import {
  createDecipheriv,
  createECDH,
  hkdfSync,
  webcrypto,
} from "node:crypto";
import { readFile } from "node:fs/promises";
import ts from "typescript";

// Load the actual browser module after stripping its TypeScript types. Node's
// WebCrypto then exercises the same implementation that ships to the client.
const sourceUrl = new URL("../lib/crypto-browser.ts", import.meta.url);
const source = await readFile(sourceUrl, "utf8");
const transpiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ES2022,
    target: ts.ScriptTarget.ES2022,
  },
  fileName: "crypto-browser.ts",
});
const moduleUrl = `data:text/javascript;base64,${Buffer.from(
  transpiled.outputText,
).toString("base64")}`;
const { encryptSecret, SECRET_ENCRYPTION_ALGORITHM } = await import(moduleUrl);

if (!globalThis.crypto) {
  Object.defineProperty(globalThis, "crypto", { value: webcrypto });
}

const plaintext = "browser-node-interop-test-한글";
const slug = "sample/2026-07-14/001";
const id = "test_key";
const aad = `${slug}:${id}`;

const recipient = createECDH("prime256v1");
recipient.generateKeys();
const recipientPublicRaw = recipient.getPublicKey();
const recipientPrivateKey = recipient.getPrivateKey();

assert.equal(recipientPublicRaw.length, 65);
assert.equal(recipientPublicRaw[0], 0x04);

const encryptedSecret = await encryptSecret({
  id,
  plaintext,
  recipientPubKey: recipientPublicRaw.toString("base64"),
  slug,
});

assert.equal(encryptedSecret.id, id);
assert.equal(
  encryptedSecret.alg,
  "ecdh-p256-hkdf-sha256-aes256gcm",
);
assert.equal(encryptedSecret.alg, SECRET_ENCRYPTION_ALGORITHM);
assert.equal(encryptedSecret.aad, aad);

const ephemeralPublicRaw = Buffer.from(
  encryptedSecret.ephemeralPubKey,
  "base64",
);
const iv = Buffer.from(encryptedSecret.iv, "base64");
const encrypted = Buffer.from(encryptedSecret.ciphertext, "base64");
const plaintextLength = Buffer.byteLength(plaintext, "utf8");

assert.equal(ephemeralPublicRaw.length, 65);
assert.equal(ephemeralPublicRaw[0], 0x04);
assert.equal(iv.length, 12);
assert.equal(encrypted.length, plaintextLength + 16);

const nodeRecipient = createECDH("prime256v1");
nodeRecipient.setPrivateKey(recipientPrivateKey);
const nodeSharedSecret = nodeRecipient.computeSecret(ephemeralPublicRaw);
const nodeAesKey = Buffer.from(
  hkdfSync(
    "sha256",
    nodeSharedSecret,
    Buffer.alloc(0),
    Buffer.from("humanfeedback-secret-v1", "utf8"),
    32,
  ),
);
const ciphertext = encrypted.subarray(0, -16);
const authTag = encrypted.subarray(-16);
const decipher = createDecipheriv("aes-256-gcm", nodeAesKey, iv);
decipher.setAAD(Buffer.from(aad, "utf8"));
decipher.setAuthTag(authTag);
const decrypted = Buffer.concat([
  decipher.update(ciphertext),
  decipher.final(),
]);

assert.equal(nodeSharedSecret.length, 32);
assert.equal(nodeAesKey.length, 32);
assert.equal(authTag.length, 16);
assert.equal(decrypted.toString("utf8"), plaintext);

recipientPublicRaw.fill(0);
recipientPrivateKey.fill(0);
ephemeralPublicRaw.fill(0);
iv.fill(0);
encrypted.fill(0);
nodeSharedSecret.fill(0);
nodeAesKey.fill(0);
decrypted.fill(0);

console.log("crypto interop: browser module -> node:crypto decrypt passed");
