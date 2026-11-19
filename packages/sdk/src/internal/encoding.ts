// Base64 and UTF-8 helpers built on Web APIs only, so the SDK runs without Node's Buffer.

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function utf8(text: string): Uint8Array<ArrayBuffer> {
  return encoder.encode(text) as Uint8Array<ArrayBuffer>;
}

export function fromUtf8(bytes: Uint8Array): string {
  return decoder.decode(bytes);
}

export function base64ToBytes(base64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

export function base64UrlToBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const base64 = base64url.replace(/-/g, '+').replace(/_/g, '/');
  return base64ToBytes(base64 + '='.repeat((4 - (base64.length % 4)) % 4));
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/** Compares two byte arrays in time that depends only on their length. */
export function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left[index] ^ right[index];
  return difference === 0;
}
