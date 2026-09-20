import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildStatement, csvCell, statementCsv, type StatementRow } from "./custody-statement.ts";

/** Task 073 / IC-002 — the period statement's totals and its CSV. */

const rows: StatementRow[] = [
  {
    at: "2026-09-02T10:00:00.000Z",
    kind: "fill",
    wallet: "0xaaa",
    reference: "0xt2",
    amountUsd: 40,
    feeUsd: 0.5,
    detail: "buy YES market-1",
  },
  {
    at: "2026-09-01T10:00:00.000Z",
    kind: "withdrawal",
    wallet: "0xbbb",
    reference: "w1",
    amountUsd: 1500,
    feeUsd: null,
    detail: "executed → Anchorage",
  },
  {
    at: "2026-09-03T10:00:00.000Z",
    kind: "spend",
    wallet: "0xaaa",
    reference: "2026-09-03",
    amountUsd: 40,
    feeUsd: null,
    detail: "1 transaction",
  },
];

void describe("buildStatement", () => {
  void it("orders rows by time and totals by kind", () => {
    const s = buildStatement({
      from: new Date("2026-09-01T00:00:00Z"),
      to: new Date("2026-10-01T00:00:00Z"),
      wallets: ["0xaaa", "0xbbb"],
      rows,
    });
    assert.deepEqual(
      s.rows.map((r) => r.reference),
      ["w1", "0xt2", "2026-09-03"],
    );
    assert.deepEqual(s.totals, {
      rows: 3,
      fillVolumeUsd: 40,
      feesUsd: 0.5,
      sendsUsd: 0,
      withdrawalsUsd: 1500,
      spendUsd: 40,
    });
    assert.equal(s.period.from, "2026-09-01T00:00:00.000Z");
  });
});

void describe("statementCsv", () => {
  void it("quotes cells with commas, quotes and newlines", () => {
    assert.equal(csvCell("plain"), "plain");
    assert.equal(csvCell('a "b", c'), '"a ""b"", c"');
    assert.equal(csvCell("x\ny"), '"x\ny"');
    assert.equal(csvCell(null), "");
  });
  void it("writes a header and one line per row", () => {
    const s = buildStatement({
      from: new Date("2026-09-01T00:00:00Z"),
      to: new Date("2026-10-01T00:00:00Z"),
      wallets: ["0xaaa"],
      rows: [rows[0]],
    });
    const lines = statementCsv(s).split("\n");
    assert.equal(lines[0], "at,kind,wallet,reference,amount_usd,fee_usd,detail");
    assert.equal(lines[1], "2026-09-02T10:00:00.000Z,fill,0xaaa,0xt2,40.00,0.50,buy YES market-1");
    assert.equal(lines.length, 2);
  });
});
