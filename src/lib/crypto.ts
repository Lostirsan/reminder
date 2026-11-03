// AES-GCM encryption for integration tokens stored in the database, plus HMAC helpers for
// webhook signatures. Web Crypto only, so it runs on Cloudflare Workers and in Node.
const enc = new TextEncoder();

function b64(bytes: ArrayBuffer | Uint8Array) {
  const u = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = "";
  for (const b of u) s += String.fromCharCode(b);
  return btoa(s);
}
function unb64(s: string) {
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
}

async function aesKey(secret = process.env.SECRETS_KEY) {
  if (!secret) throw new Error("SECRETS_KEY is not set (32 random bytes, base64)");
  const raw = unb64(secret);
  if (raw.length !== 32) throw new Error("SECRETS_KEY must be 32 bytes, base64-encoded");
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function encryptJson(value: unknown, secret?: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await aesKey(secret), enc.encode(JSON.stringify(value)));
  return `v1.${b64(iv)}.${b64(data)}`;
}

export async function decryptJson<T>(payload: string, secret?: string): Promise<T> {
  const [v, iv, data] = payload.split(".");
  if (v !== "v1" || !iv || !data) throw new Error("bad ciphertext");
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(iv) }, await aesKey(secret), unb64(data));
  return JSON.parse(new TextDecoder().decode(plain)) as T;
}

export async function hmac(algo: "SHA-256" | "SHA-1", key: string, message: string) {
  const k = await crypto.subtle.importKey("raw", enc.encode(key), { name: "HMAC", hash: algo }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", k, enc.encode(message)));
}
export const toHex = (u: Uint8Array) => Array.from(u, (b) => b.toString(16).padStart(2, "0")).join("");
export const toBase64 = (u: Uint8Array) => b64(u);

/** Constant-time string comparison. */
export function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}
