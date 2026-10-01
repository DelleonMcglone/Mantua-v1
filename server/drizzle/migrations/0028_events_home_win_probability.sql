-- K-01 — the registry keeper needs a live model probability per game. The
-- provider's home-win probability (bps) is persisted on the canonical event
-- when the feed carries one; absent, the keeper falls back to the market's
-- opening probability at lower confidence.
ALTER TABLE "events" ADD COLUMN "home_win_probability_bps" integer;
