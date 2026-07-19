import test from "node:test";
import assert from "node:assert/strict";
import { isOkfLoopbackHost, isOkfPrivateLanIpLiteral } from "../dist/kosmos-core.mjs";

test("LAN model policy accepts private IP literals but rejects DNS and public/bind-all addresses", () => {
  for (const host of ["10.0.0.8", "172.16.2.4", "172.31.255.9", "192.168.1.40", "169.254.10.2", "[fd12::8]", "[fe80::1]"]) assert.equal(isOkfPrivateLanIpLiteral(host), true, host);
  for (const host of ["model.local", "nas.example", "8.8.8.8", "172.32.0.1", "0.0.0.0", "127.0.0.1", "[::1]"]) assert.equal(isOkfPrivateLanIpLiteral(host), false, host);
});

test("loopback policy recognizes localhost, IPv4 loopback range, and IPv6 loopback", () => {
  for (const host of ["localhost", "127.0.0.1", "127.9.8.7", "[::1]"]) assert.equal(isOkfLoopbackHost(host), true, host);
  for (const host of ["192.168.1.2", "model.local", "0.0.0.0"]) assert.equal(isOkfLoopbackHost(host), false, host);
});
