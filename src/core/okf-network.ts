function ipv4(host: string): number[] | null {
  const parts = host.split(".");
  if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/.test(part))) return null;
  const bytes = parts.map(Number);
  return bytes.every((byte) => byte >= 0 && byte <= 255) ? bytes : null;
}

function unbracket(host: string): string {
  return host.trim().toLowerCase().replace(/^\[|\]$/g, "").replace(/%.+$/, "");
}

export function isOkfLoopbackHost(host: string): boolean {
  const value = unbracket(host);
  const v4 = ipv4(value);
  return value === "localhost" || value === "::1" || !!v4 && v4[0] === 127;
}

/** Literal RFC1918/IPv4 link-local or IPv6 ULA/link-local address. DNS names are rejected. */
export function isOkfPrivateLanIpLiteral(host: string): boolean {
  const value = unbracket(host);
  const v4 = ipv4(value);
  if (v4) return v4[0] === 10 || v4[0] === 192 && v4[1] === 168 || v4[0] === 172 && v4[1] >= 16 && v4[1] <= 31 || v4[0] === 169 && v4[1] === 254;
  const mapped = value.match(/^(?:::ffff:)(\d+\.\d+\.\d+\.\d+)$/i);
  if (mapped) return isOkfPrivateLanIpLiteral(mapped[1]);
  if (!value.includes(":")) return false;
  const firstText = value.split(":")[0] || "0";
  const first = Number.parseInt(firstText, 16);
  return Number.isFinite(first) && (first >= 0xfc00 && first <= 0xfdff || first >= 0xfe80 && first <= 0xfebf);
}
