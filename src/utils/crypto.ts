/**
 * E2E Encryption — AES-GCM 256-bit via Web Crypto API
 * ─────────────────────────────────────────────────────
 * Key derivation:  PBKDF2(roomCode + SECRET_SALT, 310_000 iters) → AES-GCM 256
 * The key is derived entirely in the browser from the room code.
 * The raw key NEVER leaves the device — only ciphertext hits the broker.
 *
 * Wire format (base64):
 *   [ 1 byte version | 12 bytes IV | N bytes ciphertext ]
 */

const VERSION       = 0x01;
const PBKDF2_ITERS  = 310_000;   // OWASP 2023 minimum for AES-256
const SALT_STR      = 'TempLink-E2E-v1-salt-🔐';   // static app-level salt

// Cache derived keys per room code so we only run PBKDF2 once per session
const keyCache = new Map<string, CryptoKey>();

// ─── Key derivation ──────────────────────────────────────────────────────────

export async function deriveKey(roomCode: string): Promise<CryptoKey> {
  if (keyCache.has(roomCode)) return keyCache.get(roomCode)!;

  const enc      = new TextEncoder();
  const keyMat   = await crypto.subtle.importKey(
    'raw', enc.encode(roomCode.toUpperCase()),
    'PBKDF2', false, ['deriveKey']
  );

  const salt     = enc.encode(SALT_STR);
  const key      = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITERS, hash: 'SHA-256' },
    keyMat,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );

  keyCache.set(roomCode, key);
  return key;
}

// ─── Encrypt ─────────────────────────────────────────────────────────────────

export async function encryptPayload(
  payload: unknown,
  roomCode: string
): Promise<string> {
  const key       = await deriveKey(roomCode);
  const iv        = crypto.getRandomValues(new Uint8Array(12));      // 96-bit IV
  const plaintext = new TextEncoder().encode(JSON.stringify(payload));

  const cipher = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    plaintext
  );

  // Wire: [version(1)] + [iv(12)] + [ciphertext]
  const out = new Uint8Array(1 + 12 + cipher.byteLength);
  out[0] = VERSION;
  out.set(iv, 1);
  out.set(new Uint8Array(cipher), 13);

  return btoa(String.fromCharCode(...out));
}

// ─── Decrypt ─────────────────────────────────────────────────────────────────

export async function decryptPayload<T = unknown>(
  encoded: string,
  roomCode: string
): Promise<T> {
  const bytes = Uint8Array.from(atob(encoded), c => c.charCodeAt(0));

  const version = bytes[0];
  if (version !== VERSION) throw new Error(`Unknown encryption version: ${version}`);

  const iv         = bytes.slice(1, 13);
  const ciphertext = bytes.slice(13);
  const key        = await deriveKey(roomCode);

  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    key,
    ciphertext
  );

  return JSON.parse(new TextDecoder().decode(plain)) as T;
}

// ─── Fingerprint (for UI display) ────────────────────────────────────────────
// Shows a short hex fingerprint of the derived key so users can visually verify
// both sides are using the same key (same room code).

export async function keyFingerprint(roomCode: string): Promise<string> {
  const enc  = new TextEncoder();
  const hash = await crypto.subtle.digest('SHA-256', enc.encode(`fp:${roomCode.toUpperCase()}:${SALT_STR}`));
  const hex  = Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
  // Return 4 groups of 4 hex chars for display: ABCD·EF01·2345·6789
  return [hex.slice(0, 4), hex.slice(4, 8), hex.slice(8, 12), hex.slice(12, 16)]
    .join('·')
    .toUpperCase();
}
