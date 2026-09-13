import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  KINDS_BY_CATEGORY,
  dayLabel,
  filterItems,
  groupByDay,
  kindQueryFor,
  metaLine,
  relativeTime,
  statusLabel,
  statusTone,
  type ActivityItem,
} from "./activity-core.ts";

/** Phase 9 / PF-019, PF-020 — the timeline's pure rules. */

const NOW = new Date(2026, 8, 12, 20, 0, 0).getTime();
const at = (hoursAgo: number): string => new Date(NOW - hoursAgo * 3_600_000).toISOString();

function item(over: Partial<ActivityItem>): ActivityItem {
  return {
    id: "a",
    kind: "market_buy",
    category: "trade",
    status: "completed",
    actor: "user",
    summary: "bought 16.00 YES for $10.00",
    asset: "YES",
    amountRaw: "16000000",
    valueUsd: 10,
    marketId: null,
    poolId: null,
    positionRef: null,
    txHash: null,
    data: {},
    createdAt: at(1),
    updatedAt: at(1),
    ...over,
  };
}

void describe("filters", () => {
  void it("maps every category to server kinds and builds the kind query", () => {
    assert.equal(kindQueryFor("all"), null);
    assert.equal(kindQueryFor("agent"), "agent_research,agent_simulation,agent_recommendation");
    const all = Object.values(KINDS_BY_CATEGORY).flat();
    assert.equal(new Set(all).size, all.length, "no kind belongs to two categories");
    assert.equal(all.length, 18);
    const items = [item({ category: "trade" }), item({ id: "b", category: "agent" })];
    assert.equal(filterItems(items, "agent").length, 1);
    assert.equal(filterItems(items, "all").length, 2);
  });
});

void describe("grouping and time", () => {
  void it("groups newest-first items by local day with Today / Yesterday labels", () => {
    const items = [
      item({ id: "1", createdAt: at(1) }),
      item({ id: "2", createdAt: at(3) }),
      item({ id: "3", createdAt: at(30) }),
    ];
    const groups = groupByDay(items, NOW);
    assert.equal(groups.length, 2);
    assert.equal(groups[0]?.label, "Today");
    assert.equal(groups[0]?.items.length, 2);
    assert.equal(groups[1]?.label, "Yesterday");
    assert.equal(dayLabel(at(24 * 10), NOW).length > 0, true);
  });

  void it("renders relative time coarsely", () => {
    assert.equal(relativeTime(at(0), NOW), "just now");
    assert.equal(relativeTime(at(0.5), NOW), "30m ago");
    assert.equal(relativeTime(at(5), NOW), "5h ago");
    assert.match(relativeTime(at(48), NOW), /\d/);
  });
});

void describe("card lines", () => {
  void it("builds the meta line from what is known and names the agent", () => {
    assert.equal(metaLine(item({})), "16 YES · $10.00");
    assert.equal(
      metaLine(
        item({ actor: "agent", amountRaw: null, asset: "Falcons vs Saints", valueUsd: null }),
      ),
      "Falcons vs Saints · by your agent",
    );
    assert.equal(metaLine(item({ asset: null, amountRaw: null, valueUsd: null })), null);
  });

  void it("maps status to a tone and a label", () => {
    assert.equal(statusTone("completed"), "success");
    assert.equal(statusTone("failed"), "error");
    assert.equal(statusTone("pending"), "pending");
    assert.equal(statusLabel("pending"), "Pending");
  });
});
