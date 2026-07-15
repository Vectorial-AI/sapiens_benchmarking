const COOKIE_NAME = "sapiens_auth";
const TOKEN_PAYLOAD = "sapiens-authenticated-v1";

export { COOKIE_NAME };

function getSitePassword(): string | undefined {
  const value = process.env.SITE_PASSWORD?.trim();
  return value || undefined;
}

function getAuthSecret(): string | undefined {
  const value = process.env.AUTH_SECRET?.trim() || getSitePassword();
  return value || undefined;
}

/** Auth is disabled when SITE_PASSWORD is unset (local/dev convenience). */
export function isAuthEnabled(): boolean {
  return Boolean(getSitePassword());
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

async function importHmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
}

function toBase64Url(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function createAuthToken(): Promise<string | null> {
  const secret = getAuthSecret();
  if (!secret) return null;
  const key = await importHmacKey(secret);
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(TOKEN_PAYLOAD),
  );
  return toBase64Url(signature);
}

export async function isValidAuthToken(token: string | undefined | null): Promise<boolean> {
  if (!token) return false;
  const expected = await createAuthToken();
  if (!expected) return false;
  return timingSafeEqual(token, expected);
}

export async function verifyPassword(password: string): Promise<boolean> {
  const expected = getSitePassword();
  if (!expected) return false;
  return timingSafeEqual(password, expected);
}

export function sanitizeNextPath(next: string | null | undefined): string {
  if (!next || !next.startsWith("/") || next.startsWith("//")) return "/";
  if (next.startsWith("/login")) return "/";
  return next;
}
