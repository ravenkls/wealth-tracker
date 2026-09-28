import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
export interface CredentialCipher {
  encrypt(plaintext: string, context: string): Promise<string>;
  decrypt(ciphertext: string, context: string): Promise<string>;
}
export class LocalCredentialCipher implements CredentialCipher {
  private readonly key: Buffer;
  constructor(key: string) {
    this.key = Buffer.from(key, "base64");
    if (this.key.length !== 32)
      throw new Error("LOCAL_ENCRYPTION_KEY must be a base64-encoded 32-byte key.");
  }
  async encrypt(plaintext: string, context: string) {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    cipher.setAAD(Buffer.from(context));
    const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    return [
      "v1",
      iv.toString("base64url"),
      cipher.getAuthTag().toString("base64url"),
      encrypted.toString("base64url"),
    ].join(".");
  }
  async decrypt(ciphertext: string, context: string) {
    const [version, iv, tag, data] = ciphertext.split(".");
    if (version !== "v1" || !iv || !tag || !data) throw new Error("Invalid encrypted credentials.");
    const cipher = createDecipheriv("aes-256-gcm", this.key, Buffer.from(iv, "base64url"));
    cipher.setAAD(Buffer.from(context));
    cipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([cipher.update(Buffer.from(data, "base64url")), cipher.final()]).toString(
      "utf8",
    );
  }
}
