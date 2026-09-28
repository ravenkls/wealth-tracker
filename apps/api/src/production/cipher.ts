import { DecryptCommand, EncryptCommand, KMSClient } from "@aws-sdk/client-kms";
import type { CredentialCipher } from "../auth/encryption";

export class KmsCredentialCipher implements CredentialCipher {
  constructor(
    private readonly client: KMSClient,
    private readonly keyId: string,
  ) {}
  async encrypt(plaintext: string, context: string): Promise<string> {
    const result = await this.client.send(
      new EncryptCommand({
        KeyId: this.keyId,
        Plaintext: Buffer.from(plaintext),
        EncryptionContext: { account: context },
      }),
    );
    if (!result.CiphertextBlob) throw new Error("Credential encryption failed");
    return `kms.v1.${Buffer.from(result.CiphertextBlob).toString("base64")}`;
  }
  async decrypt(ciphertext: string, context: string): Promise<string> {
    if (!ciphertext.startsWith("kms.v1.")) throw new Error("Unsupported credential encryption");
    const result = await this.client.send(
      new DecryptCommand({
        KeyId: this.keyId,
        CiphertextBlob: Buffer.from(ciphertext.slice(7), "base64"),
        EncryptionContext: { account: context },
      }),
    );
    if (!result.Plaintext) throw new Error("Credential decryption failed");
    return Buffer.from(result.Plaintext).toString("utf8");
  }
}
