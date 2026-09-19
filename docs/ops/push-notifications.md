# Push notifications — operations (Phase 15, task 071, MX-004)

Web Push, standards only: RFC 8030 (the protocol), RFC 8291 (message
encryption), RFC 8292 (VAPID). Implemented in `server/src/lib/push/` on
`node:crypto`; no push library, no third-party relay. The push services
(Google's, Apple's, Mozilla's) see ciphertext and our application public
key, nothing else.

## Turning it on

```bash
npm run push:generate-keys -w @mantua/server
```

Copy the three lines into `server/.env` and the hosting environment:

| Variable            | What it is                                                    |
| ------------------- | ------------------------------------------------------------- |
| `VAPID_PUBLIC_KEY`  | base64url, the raw 65-byte P-256 point — sent to browsers     |
| `VAPID_PRIVATE_KEY` | base64url, the 32-byte scalar — signs every push; server only |
| `VAPID_SUBJECT`     | `mailto:` or `https:` contact a push service may use about us |

Without all three the feature is dark: `GET /api/push/config` answers
`enabled: false`, the client never asks for permission, the live-sync tick
runs no alert queries, and every dispatch returns `disabled`.

Run migration `0023_push_subscriptions.sql` (`npm run db:migrate -w
@mantua/server`; the Vercel build command runs it).

## Rotating the keys

A new pair invalidates every subscription: browsers holding the old key
get `410 Gone` on the next send, the dispatcher deletes those rows, and
each browser re-subscribes the next time its user opens the notification
settings. Rotate deliberately, announce it, and expect a quiet day.

## What is sent, and when

| Topic        | Trigger                                                                   | Tag (idempotency key)     |
| ------------ | ------------------------------------------------------------------------- | ------------------------- | --------- |
| `trades`     | a verified fill recorded on the activity spine (`market_buy`/`sell`)      | `trade:<txHash>`          |
| `agent`      | an agent trade, hedge or recommendation recorded on the spine             | `agent:<action>:<ref>`    |
| `settlement` | a position marked settled; a redeem                                       | `settlement:<positionId>` |
| `games`      | live-sync observes `scheduled → in_progress` or `→ final` for a held game | `game:<eventId>:kickoff   | final`    |
| `positions`  | live-sync finds a held side ≥ 10¢ from entry (per 10¢ step, per side)     | `position:<marketId>:<up  | down><n>` |

`push_deliveries` has a unique index on `(user_id, tag)`; the dispatcher
inserts there **before** sending, so two instances reacting to one fill
race for the row and exactly one sends. A replayed fill report, a re-run
cron tick, or a price that crosses the same step twice sends nothing.

Every message is a title, one sentence, and an in-app path
(`/?open=…`, see `client/src/lib/launch-route.ts`). Nothing in a push can
confirm or execute anything, and no push carries a balance, an address or
chain vocabulary (asserted in `notifications.test.ts`).

## Reading the logs

- `push: delivery failed` (warn) — one line per failed send with the
  outcome (`rate_limited`, `rejected`, `failed`) and the tag. A burst of
  `rejected` with HTTP 401/403 means the VAPID keys on the deployment do
  not match the key browsers subscribed with (a partial rotation).
- `push: activity notification failed` (warn) — the bridge threw; the
  activity row was still written.
- The live-sync response carries `gameAlerts` per league and
  `positionAlerts` for the tick.

## Per-instance costs

One `SELECT` per user per push, one `INSERT` per delivery, one HTTPS
POST per subscribed browser. The position pass runs one join over open
positions and one `DISTINCT ON` over pool prices per tick; it is skipped
entirely when keys are absent.

## Privacy

A subscription row is the push service URL and two opaque keys, tied to
the user id; it is deleted on unsubscribe, on cascade with the user, and
when the service reports it gone. `user_agent` is stored (capped at 200
characters) so a user can tell their phone from their laptop in a future
settings view. No payload is stored; the delivery log keeps only the tag.
