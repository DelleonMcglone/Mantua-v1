import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { launchedFromInstalledApp, parseLaunchParams, stripLaunchParams } from "./launch-route.ts";

void describe("launch route (MX-004 / MX-007)", () => {
  void it("reads a market deep link with its optional game and side", () => {
    assert.deepEqual(parseLaunchParams("?open=market&league=nfl"), {
      kind: "market",
      league: "nfl",
    });
    assert.deepEqual(parseLaunchParams("?open=market&league=nfl&event=401547401&side=1"), {
      kind: "market",
      league: "nfl",
      eventId: "401547401",
      side: 1,
    });
    assert.deepEqual(parseLaunchParams("?open=market&league=nfl&side=0"), {
      kind: "market",
      league: "nfl",
      side: 0,
    });
  });

  void it("ignores what it does not know, and never trusts a bad league, event or side", () => {
    assert.equal(parseLaunchParams(""), null);
    assert.equal(parseLaunchParams("?open=settings"), null);
    assert.equal(parseLaunchParams("?open=market"), null);
    assert.equal(parseLaunchParams("?open=market&league=cricket"), null);
    assert.deepEqual(parseLaunchParams("?open=market&league=nfl&side=2&event=<script>"), {
      kind: "market",
      league: "nfl",
    });
    for (const kind of ["profile", "agent", "discover", "home"] as const) {
      assert.deepEqual(parseLaunchParams(`?open=${kind}&x=1`), { kind });
    }
  });

  void it("strips only its own keys and recognises the installed-app launch", () => {
    assert.equal(
      stripLaunchParams("https://mantua.ai/?open=market&league=nfl&event=1&side=0&utm=x#top"),
      "/?utm=x#top",
    );
    assert.equal(stripLaunchParams("https://mantua.ai/?source=pwa"), "/");
    assert.equal(launchedFromInstalledApp("?source=pwa"), true);
    assert.equal(launchedFromInstalledApp("?open=profile"), false);
  });
});
