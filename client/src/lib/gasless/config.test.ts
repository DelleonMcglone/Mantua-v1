import { strict as assert } from "node:assert";
import { test } from "node:test";
import { parseFlag, parsePaymasterContext, resolveGaslessConfig } from "./config.ts";

test("parseFlag: only explicit truthy values enable", () => {
  for (const v of ["1", "true", "TRUE", "True", "yes", "on", " true ", '"true"']) {
    assert.equal(parseFlag(v), true, `expected truthy: ${JSON.stringify(v)}`);
  }
  for (const v of [undefined, "", "0", "false", "off", "no", "enabled", "gasless", "tru e"]) {
    assert.equal(parseFlag(v), false, `expected falsy: ${JSON.stringify(v)}`);
  }
});

test("parsePaymasterContext: valid JSON object passes through", () => {
  assert.deepEqual(parsePaymasterContext('{"policyId":"pol_123","mode":"SPONSORED"}'), {
    policyId: "pol_123",
    mode: "SPONSORED",
  });
  assert.deepEqual(parsePaymasterContext("{}"), {});
});

test("parsePaymasterContext: non-objects and junk resolve to undefined", () => {
  assert.equal(parsePaymasterContext(undefined), undefined);
  assert.equal(parsePaymasterContext(""), undefined);
  assert.equal(parsePaymasterContext("not-json"), undefined);
  assert.equal(parsePaymasterContext('"just-a-string"'), undefined);
  assert.equal(parsePaymasterContext("[1,2,3]"), undefined);
  assert.equal(parsePaymasterContext("42"), undefined);
  assert.equal(parsePaymasterContext("null"), undefined);
});

test("resolveGaslessConfig: defaults OFF with everything unset", () => {
  assert.deepEqual(resolveGaslessConfig({}), { enabled: false, paymasterContext: undefined });
});

test("resolveGaslessConfig: flag on, optional context", () => {
  assert.deepEqual(resolveGaslessConfig({ VITE_GASLESS_ENABLED: "true" }), {
    enabled: true,
    paymasterContext: undefined,
  });
  assert.deepEqual(
    resolveGaslessConfig({
      VITE_GASLESS_ENABLED: "1",
      VITE_GASLESS_PAYMASTER_CONTEXT: '{"policyId":"p"}',
    }),
    { enabled: true, paymasterContext: { policyId: "p" } },
  );
});

test("resolveGaslessConfig: malformed context never disables the resolution shape", () => {
  // A bad context degrades to "no context" — it must not throw.
  assert.deepEqual(
    resolveGaslessConfig({ VITE_GASLESS_ENABLED: "true", VITE_GASLESS_PAYMASTER_CONTEXT: "{oops" }),
    { enabled: true, paymasterContext: undefined },
  );
});
