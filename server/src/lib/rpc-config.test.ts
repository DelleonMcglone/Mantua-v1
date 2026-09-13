import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  RPC_HOST_FAILURE_THRESHOLD,
  RpcHealthRegistry,
  isPublicRpcUrl,
  parseUrlList,
  resolveRpcUrls,
  rpcProviderIssues,
} from "./rpc-config.ts";

const DEDICATED = "https://base-mainnet.g.alchemy.com/v2/KEY";
const DEDICATED_2 = "https://ancient-icy-sky.base-mainnet.quiknode.pro/KEY2/";

/**
 * Phase 7 / R-006 — no public rate-limited endpoint in production: the
 * upstream list is pure and the boot check is exact.
 */
void describe("isPublicRpcUrl", () => {
  void it("recognizes the public Base hosts (and subdomains), not dedicated providers", () => {
    assert.equal(isPublicRpcUrl("https://mainnet.base.org"), true);
    assert.equal(isPublicRpcUrl("https://base-rpc.publicnode.com"), true);
    assert.equal(isPublicRpcUrl("https://base.llamarpc.com"), true);
    assert.equal(isPublicRpcUrl("https://rpc.base.drpc.org"), true, "subdomain of a public host");
    assert.equal(isPublicRpcUrl(DEDICATED), false);
    assert.equal(isPublicRpcUrl(DEDICATED_2), false);
    assert.equal(isPublicRpcUrl("not a url"), false);
  });
});

void describe("resolveRpcUrls", () => {
  void it("outside production: primary, dedicated fallbacks, then the public backstop, de-duplicated", () => {
    assert.deepEqual(
      resolveRpcUrls({
        NODE_ENV: "development",
        BASE_RPC_URL: DEDICATED,
        BASE_RPC_FALLBACK_URLS: `${DEDICATED_2}, ${DEDICATED}`,
      }),
      [DEDICATED, DEDICATED_2, "https://mainnet.base.org", "https://base-rpc.publicnode.com"],
    );
  });

  void it("in production the public hosts are NOT appended unless explicitly allowed", () => {
    assert.deepEqual(
      resolveRpcUrls({
        NODE_ENV: "production",
        BASE_RPC_URL: DEDICATED,
        BASE_RPC_FALLBACK_URLS: DEDICATED_2,
      }),
      [DEDICATED, DEDICATED_2],
    );
    assert.deepEqual(
      resolveRpcUrls({
        NODE_ENV: "production",
        BASE_RPC_URL: DEDICATED,
        BASE_RPC_PUBLIC_FALLBACK: "1",
      }),
      [DEDICATED, "https://mainnet.base.org", "https://base-rpc.publicnode.com"],
    );
    assert.deepEqual(
      resolveRpcUrls({
        NODE_ENV: "development",
        BASE_RPC_URL: DEDICATED,
        BASE_RPC_PUBLIC_FALLBACK: "0",
      }),
      [DEDICATED],
    );
  });

  void it("the dev default (a public primary) still yields a working list", () => {
    assert.deepEqual(
      resolveRpcUrls({ NODE_ENV: "development", BASE_RPC_URL: "https://mainnet.base.org" }),
      ["https://mainnet.base.org", "https://base-rpc.publicnode.com"],
    );
  });
});

void describe("rpcProviderIssues (the boot check)", () => {
  void it("a public primary is an issue everywhere (env.ts makes it fatal in production)", () => {
    const issues = rpcProviderIssues({
      NODE_ENV: "production",
      BASE_RPC_URL: "https://mainnet.base.org",
    });
    assert.equal(issues.length, 1);
    assert.match(issues[0] ?? "", /public, rate-limited host mainnet\.base\.org/);
    assert.match(issues[0] ?? "", /dedicated RPC endpoint/);
  });

  void it("a dedicated primary with dedicated fallbacks and no public backstop is clean", () => {
    assert.deepEqual(
      rpcProviderIssues({
        NODE_ENV: "production",
        BASE_RPC_URL: DEDICATED,
        BASE_RPC_FALLBACK_URLS: DEDICATED_2,
      }),
      [],
    );
  });

  void it("a public host in the fallback list, or the public backstop enabled in production, are issues", () => {
    const fallback = rpcProviderIssues({
      NODE_ENV: "production",
      BASE_RPC_URL: DEDICATED,
      BASE_RPC_FALLBACK_URLS: "https://base.llamarpc.com",
    });
    assert.equal(fallback.length, 1);
    assert.match(fallback[0] ?? "", /BASE_RPC_FALLBACK_URLS contains the public host/);
    const backstop = rpcProviderIssues({
      NODE_ENV: "production",
      BASE_RPC_URL: DEDICATED,
      BASE_RPC_PUBLIC_FALLBACK: "1",
    });
    assert.equal(backstop.length, 1);
    assert.match(backstop[0] ?? "", /BASE_RPC_PUBLIC_FALLBACK=1 in production/);
    // Outside production the backstop is fine.
    assert.deepEqual(
      rpcProviderIssues({
        NODE_ENV: "development",
        BASE_RPC_URL: DEDICATED,
        BASE_RPC_PUBLIC_FALLBACK: "1",
      }),
      [],
    );
  });
});

void describe("parseUrlList", () => {
  void it("splits on commas, trims, drops blanks and duplicates", () => {
    assert.deepEqual(parseUrlList(" a ,b,, a ,c "), ["a", "b", "c"]);
    assert.deepEqual(parseUrlList(undefined), []);
    assert.deepEqual(parseUrlList(""), []);
  });
});

void describe("RpcHealthRegistry (R-005's RPC rung)", () => {
  void it("starts healthy, counts consecutive failures per host, and reports fallback when the primary is down", () => {
    const r = new RpcHealthRegistry([DEDICATED, DEDICATED_2, "https://mainnet.base.org"]);
    let s = r.snapshot();
    assert.equal(s.healthy, true);
    assert.equal(s.onFallback, false);
    assert.equal(s.detail, "ok");
    assert.equal(
      s.hosts[0]?.host,
      "base-mainnet.g.alchemy.com",
      "hostname only — never the keyed URL",
    );
    assert.equal(s.hosts[0]?.primary, true);
    assert.equal(s.hosts[2]?.public, true);

    for (let i = 0; i < RPC_HOST_FAILURE_THRESHOLD; i += 1)
      r.record(0, false, new Error("429 rate limit"), 1_000 + i);
    s = r.snapshot();
    assert.equal(s.hosts[0]?.consecutiveFailures, RPC_HOST_FAILURE_THRESHOLD);
    assert.equal(s.hosts[0]?.lastError, "429 rate limit");
    assert.equal(s.healthy, true, "the fallbacks are still up");
    assert.equal(s.onFallback, true);
    assert.match(s.detail, /primary base-mainnet\.g\.alchemy\.com failing — on fallback/);

    r.record(0, true, undefined, 2_000);
    s = r.snapshot();
    assert.equal(s.hosts[0]?.consecutiveFailures, 0, "one success resets the streak");
    assert.equal(s.hosts[0]?.lastOkAt, 2_000);
    assert.equal(s.onFallback, false);
  });

  void it("every host down → unhealthy with a clear detail", () => {
    const r = new RpcHealthRegistry([DEDICATED, DEDICATED_2]);
    for (let i = 0; i < RPC_HOST_FAILURE_THRESHOLD; i += 1) {
      r.record(0, false, "boom");
      r.record(1, false, "boom");
    }
    const s = r.snapshot();
    assert.equal(s.healthy, false);
    assert.equal(s.detail, "all 2 RPC hosts failing");
  });

  void it("ignores an out-of-range index (a transport key it does not know)", () => {
    const r = new RpcHealthRegistry([DEDICATED]);
    r.record(7, false, "x");
    assert.equal(r.snapshot().hosts.length, 1);
    assert.equal(r.snapshot().healthy, true);
  });
});
