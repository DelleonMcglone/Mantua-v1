import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { AGENT_MODES } from "../agent/agent-mode.ts";
import { KNOWLEDGE, searchKnowledge, topicById } from "./knowledge.ts";

/** Task 070 / AE-007 — the knowledge base is well-formed and in sync with the code it describes. */

void describe("knowledge", () => {
  void it("has unique ids, a title, keywords and a body for every topic", () => {
    const ids = new Set(KNOWLEDGE.map((t) => t.id));
    assert.equal(ids.size, KNOWLEDGE.length);
    for (const t of KNOWLEDGE) {
      assert.ok(t.title.length > 0 && t.keywords.length > 0 && t.body.length > 80, t.id);
    }
  });

  void it("ranks the topic that matches the question first", () => {
    assert.equal(searchKnowledge("how do I deposit from my bank")[0]?.id, "deposits");
    assert.equal(searchKnowledge("withdraw my winnings to my bank account")[0]?.id, "withdrawals");
    assert.equal(searchKnowledge("why is my microphone not working")[0]?.id, "voice");
    assert.deepEqual(searchKnowledge("zzz qqq"), []);
    assert.ok(searchKnowledge("trade position deposit", 2).length <= 2);
  });

  void it("describes the agent modes the server actually has", () => {
    const agent = topicById("agent");
    assert.ok(agent);
    for (const mode of AGENT_MODES) assert.ok(agent.body.includes(mode), mode);
    assert.equal(topicById("nope"), null);
  });
});
