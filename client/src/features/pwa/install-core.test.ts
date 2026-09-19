import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  INSTALL_DISMISS_MS,
  installOffer,
  isIosBrowser,
  type InstallContext,
} from "./install-core.ts";

const base: InstallContext = {
  mobile: true,
  standalone: false,
  ios: false,
  canPrompt: true,
  earned: true,
  dismissedAt: null,
  now: 1_800_000_000_000,
};

void describe("install offer (MX-007)", () => {
  void it("offers the prompt on a phone browser once earned, and the iOS steps where there is no prompt", () => {
    assert.equal(installOffer(base), "prompt");
    assert.equal(installOffer({ ...base, canPrompt: false, ios: true }), "ios-steps");
    assert.equal(installOffer({ ...base, canPrompt: false, ios: false }), "none");
  });

  void it("never offers on desktop, inside the installed app, before it is earned, or within two weeks of a dismissal", () => {
    assert.equal(installOffer({ ...base, mobile: false }), "none");
    assert.equal(installOffer({ ...base, standalone: true }), "none");
    assert.equal(installOffer({ ...base, earned: false }), "none");
    assert.equal(installOffer({ ...base, dismissedAt: base.now - 1000 }), "none");
    assert.equal(
      installOffer({ ...base, dismissedAt: base.now - INSTALL_DISMISS_MS - 1 }),
      "prompt",
    );
  });

  void it("recognises iOS including iPadOS in desktop mode", () => {
    assert.equal(isIosBrowser("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)", 5), true);
    assert.equal(isIosBrowser("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", 5), true);
    assert.equal(isIosBrowser("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", 0), false);
    assert.equal(isIosBrowser("Mozilla/5.0 (Linux; Android 14; Pixel 8)", 5), false);
  });
});
