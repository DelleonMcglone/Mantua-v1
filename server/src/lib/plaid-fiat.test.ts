import assert from "node:assert/strict";
import test from "node:test";
import {
  FiatRailsUnavailableError,
  _setFiatRailsModeForTests,
  _setFiatStoreForTests,
  completeBankLinkExchange,
  createFiatLinkToken,
} from "./fiat-rails.ts";
import { createMemoryFiatStore } from "./fiat-store.ts";
import { PlaidNotConfiguredError, plaidClient, plaidConfigured } from "./plaid-fiat.ts";

// These assertions describe the credential-absent posture (the CI/stub
// environment). With real Plaid creds in the env they self-skip.
const configured = plaidConfigured();

test("plaid client refuses to construct without credentials", { skip: configured }, () => {
  assert.throws(() => plaidClient(), PlaidNotConfiguredError);
});

test(
  "link-token and exchange degrade to 503-style unavailability without Plaid creds",
  { skip: configured },
  async () => {
    try {
      _setFiatStoreForTests(createMemoryFiatStore());
      _setFiatRailsModeForTests("sandbox");
      await assert.rejects(createFiatLinkToken("user-a"), FiatRailsUnavailableError);
      await assert.rejects(
        completeBankLinkExchange("user-a", "public-sandbox-token"),
        FiatRailsUnavailableError,
      );
    } finally {
      _setFiatStoreForTests(null);
      _setFiatRailsModeForTests(null);
    }
  },
);
