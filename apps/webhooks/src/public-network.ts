// Consumer webhook URLs are untrusted. The gateway checks a URL when it is registered; this check
// runs again at every connection, against the addresses actually dialled, because DNS can change.
// The ranges match the gateway's upstream guard (apps/gateway/src/shared/proxy/upstream-guard.ts);
// a unit test keeps the two in step.
import { lookup as dnsLookup, type LookupAddress, type LookupOptions } from "node:dns";
import { isIP } from "node:net";

export function isPrivateAddress(address: string): boolean {
  if (isIP(address) === 4) {
    const [a, b] = address.split(".").map(Number);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 192 && b === 0) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224
    );
  }
  const value = address.toLowerCase();
  if (value === "::" || value === "::1") return true;
  if (value.startsWith("::ffff:")) return isPrivateAddress(value.slice(7));
  return /^(fc|fd|fe8|fe9|fea|feb|ff)/.test(value) || value.startsWith("64:ff9b:") || value.startsWith("2001:db8:");
}

type LookupCallback = (error: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void;

/** A `lookup` for http(s).request that refuses to connect to any private or internal address. */
export function publicOnlyLookup(hostname: string, options: LookupOptions, callback: LookupCallback): void {
  dnsLookup(hostname, { ...options, all: true }, (error, addresses) => {
    if (error) return callback(error, []);
    const blocked = addresses.find((entry) => isPrivateAddress(entry.address));
    if (blocked || addresses.length === 0) {
      const refusal: NodeJS.ErrnoException = new Error(`Refusing to connect to non-public address for ${hostname}`);
      refusal.code = "EADDRNOTPUBLIC";
      return callback(refusal, []);
    }
    if (options.all) return callback(null, addresses);
    return callback(null, addresses[0].address, addresses[0].family);
  });
}
