/**
 * E2E Encryption — AES-GCM 256-bit via Web Crypto API
 *
 * FIX: Replaced ALL spread-based byte↔string conversions with
 *      simple for-loops that work for ANY payload size.
 *      No .apply(), no spread (...), no stack overflow. Ever.
 */

const VERSION = 0x01;
const PBKDF2_ITERS = 310_000;
const SALT_STR = "TempLink-E2E-v1-salt-🔐";

const keyCache = new Map<string, CryptoKey>();

// ─── Safe byte ↔ base64 helpers (no spread, no apply, no stack overflow) ────

/**
 * Uint8Array → base64 string.
 * Uses a simple loop — works for 1 byte or 100 MB.
 */
function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/**
 * base64 string → Uint8Array.
 * Uses a simple loop — works for any size.
 */
function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

// ─── Key derivation ──────────────────────────────────────────────────────────

export async function deriveKey(roomCode: string): Promise<CryptoKey> {
  if (keyCache.has(roomCode)) return keyCache.get(roomCode)!;

  const enc = new TextEncoder();
  const keyMat = await crypto.subtle.importKey(
    "raw",
    enc.encode(roomCode.toUpperCase()),
    "PBKDF2",
    false,
    ["deriveKey"],
  );

  const salt = enc.encode(SALT_STR);
  const key = await crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: PBKDF2_ITERS, hash: "SHA-256" },
    keyMat,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );

  keyCache.set(roomCode, key);
  return key;
}

// ─── Encrypt ─────────────────────────────────────────────────────────────────

export async function encryptPayload(
  payload: unknown,
  roomCode: string,
): Promise<string> {
  const key = await deriveKey(roomCode);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(JSON.stringify(payload));

  const cipher = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    plaintext,
  );

  // Wire format: [version(1)] + [iv(12)] + [ciphertext(N)]
  const out = new Uint8Array(1 + 12 + cipher.byteLength);
  out[0] = VERSION;
  out.set(iv, 1);
  out.set(new Uint8Array(cipher), 13);

  // ✅ FIX: simple loop — no spread, no apply, no stack overflow
  return bytesToBase64(out);
}

// ─── Decrypt ─────────────────────────────────────────────────────────────────

export async function decryptPayload<T = unknown>(
  encoded: string,
  roomCode: string,
): Promise<T> {
  // ✅ FIX: simple loop — no spread
  const bytes = base64ToBytes(encoded);

  const version = bytes[0];
  if (version !== VERSION) {
    throw new Error(`Unknown encryption version: ${version}`);
  }

  const iv = bytes.slice(1, 13);
  const ciphertext = bytes.slice(13);
  const key = await deriveKey(roomCode);

  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    key,
    ciphertext,
  );

  return JSON.parse(new TextDecoder().decode(plain)) as T;
}

// ─── Fingerprint ─────────────────────────────────────────────────────────────

export async function keyFingerprint(roomCode: string): Promise<string> {
  const enc = new TextEncoder();
  const hash = await crypto.subtle.digest(
    "SHA-256",
    enc.encode(`fp:${roomCode.toUpperCase()}:${SALT_STR}`),
  );
  const hex = Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return [hex.slice(0, 4), hex.slice(4, 8), hex.slice(8, 12), hex.slice(12, 16)]
    .join("·")
    .toUpperCase();
}
