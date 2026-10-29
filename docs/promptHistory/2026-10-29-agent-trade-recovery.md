# 2026-10-29 — Agent trade recovery

Owner prompt: "If a trade submits but the confirmation is lost, does
recovery check the original transaction before retrying?"

Finding reported: yes for trades the user signs (pending register +
status route, fills unique on tx hash); no for trades the agent places
from chat — nothing persisted before the receipt wait, the timeout threw
with no ledger row, the webhook finalizer could not resolve it, and a
retry created a second Circle transaction.

Owner: "fix plz".

Delivered as Task 078 (`docs/tasks/078-agent-trade-recovery.md`): the
chat swap is persisted pending with an `agent_trade` kind the finalizer
knows how to apply exactly once; a timeout returns a pending result
instead of an error; the same trade inside ten minutes is refused while
pending or just confirmed. Decision D-125.
