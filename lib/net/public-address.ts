// Is an IP address on the public internet? Used to keep member-owned
// providers from reaching the gateway's own network (localhost, cloud
// metadata at 169.254.169.254, private ranges, …).

import { BlockList, isIP } from "node:net"

// Separate lists: a BlockList also matches IPv4 addresses against IPv6
// rules (as IPv4-mapped), so one list with ::ffff:0:0/96 would block all IPv4.
const blockedV4 = new BlockList()
const blockedV6 = new BlockList()

// IPv4: this-network, private, carrier-grade NAT, loopback, link-local
// (cloud metadata), IETF/test ranges, benchmarking, multicast, reserved.
for (const [network, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const) {
  blockedV4.addSubnet(network, prefix, "ipv4")
}

// IPv6: unspecified, loopback, NAT64, discard, documentation, 6to4,
// unique-local, link-local, multicast. (IPv4-mapped ::ffff:… is refused
// outright below.)
for (const [network, prefix] of [
  ["::", 128],
  ["::1", 128],
  ["64:ff9b::", 96],
  ["100::", 64],
  ["2001:db8::", 32],
  ["2002::", 16],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
] as const) {
  blockedV6.addSubnet(network, prefix, "ipv6")
}

export function isPublicAddress(address: string): boolean {
  const value = address
    .trim()
    .replace(/^\[|\]$/g, "")
    .toLowerCase()
  const family = isIP(value)
  if (family === 4) return !blockedV4.check(value, "ipv4")
  if (family === 6) {
    // IPv4-mapped (::ffff:7f00:1, ::ffff:127.0.0.1): no reason to allow any.
    if (/^(0{0,4}:){0,5}:?ffff:/.test(value) || value.startsWith("::ffff:"))
      return false
    return !blockedV6.check(value, "ipv6")
  }
  return false
}

/** "https://[::1]:8080/v1" -> "::1"; WHATWG URLs already normalise IPv4. */
export function hostOf(url: URL): string {
  return url.hostname.replace(/^\[|\]$/g, "")
}
