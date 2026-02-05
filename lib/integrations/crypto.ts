import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;

/**
 * Get encryption key from environment.
 * Key must be a 32-byte hex string (64 characters).
 * Generate with: openssl rand -hex 32
 */
function getEncryptionKey(): Buffer {
  const key = process.env.TOKEN_ENCRYPTION_KEY;

  if (!key) {
    throw new Error(
      "TOKEN_ENCRYPTION_KEY environment variable is required. " +
        "Generate with: openssl rand -hex 32",
    );
  }

  if (key.length !== 64) {
    throw new Error(
      "TOKEN_ENCRYPTION_KEY must be a 32-byte hex string (64 characters). " +
        "Generate with: openssl rand -hex 32",
    );
  }

  return Buffer.from(key, "hex");
}

/**
 * Encrypt a token using AES-256-GCM.
 * Returns format: iv:authTag:encryptedData (all hex-encoded)
 */
export function encryptToken(token: string): string {
  if (!token) {
    throw new Error("Token cannot be empty");
  }

  const key = getEncryptionKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);

  const encrypted = Buffer.concat([
    cipher.update(token, "utf8"),
    cipher.final(),
  ]);

  const authTag = cipher.getAuthTag();

  return [
    iv.toString("hex"),
    authTag.toString("hex"),
    encrypted.toString("hex"),
  ].join(":");
}

/**
 * Decrypt a token encrypted with encryptToken.
 * Expects format: iv:authTag:encryptedData (all hex-encoded)
 */
export function decryptToken(encryptedData: string): string {
  if (!encryptedData) {
    throw new Error("Encrypted data cannot be empty");
  }

  const parts = encryptedData.split(":");

  if (parts.length !== 3) {
    throw new Error("Invalid encrypted data format");
  }

  const [ivHex, authTagHex, dataHex] = parts;

  const key = getEncryptionKey();
  const iv = Buffer.from(ivHex, "hex");
  const authTag = Buffer.from(authTagHex, "hex");
  const data = Buffer.from(dataHex, "hex");

  if (iv.length !== IV_LENGTH) {
    throw new Error("Invalid IV length");
  }

  if (authTag.length !== AUTH_TAG_LENGTH) {
    throw new Error("Invalid auth tag length");
  }

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([decipher.update(data), decipher.final()]);

  return decrypted.toString("utf8");
}

/**
 * Check if encryption is properly configured.
 * Useful for startup validation.
 */
export function isEncryptionConfigured(): boolean {
  try {
    getEncryptionKey();
    return true;
  } catch {
    return false;
  }
}

/**
 * Validate encryption setup by performing a round-trip test.
 * Throws if encryption is not working properly.
 */
export function validateEncryptionSetup(): void {
  const testValue = "encryption-test-" + Date.now();
  const encrypted = encryptToken(testValue);
  const decrypted = decryptToken(encrypted);

  if (decrypted !== testValue) {
    throw new Error("Encryption round-trip validation failed");
  }
}
