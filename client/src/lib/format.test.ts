import { strict as assert } from "node:assert";
import { test } from "node:test";
import { address, compact, pct, relativeTime, token, usd } from "./format.ts";

test("usd: 2 fraction digits, en-US grouping", () => {
  assert.equal(usd(1234.5), "$1,234.50");
  assert.equal(usd(0.1), "$0.10");
  assert.equal(usd(1_000_000), "$1,000,000.00");
});

test("usd: edge cases", () => {
  assert.equal(usd(0), "$0.00");
  assert.equal(usd(0.004), "<$0.01");
  assert.equal(usd(-3.2), "$-3.20");
  assert.equal(usd(Number.NaN), "$—");
  assert.equal(usd(Number.POSITIVE_INFINITY), "$—");
});

test("compact: magnitude suffixes", () => {
  assert.equal(compact(1_234_000_000), "$1.23B");
  assert.equal(compact(1_200_000), "$1.20M");
  assert.equal(compact(824_000), "$824.00K");
  assert.equal(compact(14.32), "$14.32");
  assert.equal(compact(Number.NaN), "—");
});

test("token: up to 6 fraction digits, dust floor", () => {
  assert.equal(token(0), "0");
  assert.equal(token(0.0042), "0.0042");
  assert.equal(token(1234.5), "1,234.5");
  assert.equal(token(0.0000001), "<0.000001");
  assert.equal(token(Number.NaN), "—");
});

test("pct", () => {
  assert.equal(pct(12.345), "12.35%");
  assert.equal(pct(0), "0.00%");
  assert.equal(pct(Number.NaN), "—");
});

test("address: shortens long, passes short through", () => {
  assert.equal(address("0x1234567890abcdef1234567890abcdef12345678"), "0x1234…5678");
  assert.equal(address("0xabc"), "0xabc");
});

test("relativeTime buckets", () => {
  const now = 1_700_000_000_000; // ms
  const t = now / 1000;
  assert.equal(relativeTime(t - 5, now), "just now");
  assert.equal(relativeTime(t - 300, now), "5m ago");
  assert.equal(relativeTime(t - 7200, now), "2h ago");
  assert.equal(relativeTime(t - 172_800, now), "2d ago");
});
