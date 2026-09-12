import { useEffect } from "react";
import { usePlaidLink } from "react-plaid-link";

/**
 * F-002 — real Plaid Link launcher. Mounted only once a link token exists;
 * opens Link as soon as the SDK is ready. Only the short-lived public token
 * from `onSuccess` ever reaches our code — bank credentials stay inside
 * Plaid's iframe, and the server-side exchange keeps the access token off
 * the browser entirely (D-101). Shared by the Cash tab and the ticket's
 * Add-funds step (task 050, T-013).
 */
export function PlaidLinkLauncher(props: {
  token: string;
  onSuccess: (publicToken: string) => void;
  onExit: () => void;
}) {
  const { open, ready } = usePlaidLink({
    token: props.token,
    onSuccess: (publicToken) => {
      // The SDK types the token as nullable for OAuth edge cases; without a
      // token there is nothing to exchange — treat it as an exit.
      if (publicToken) props.onSuccess(publicToken);
      else props.onExit();
    },
    onExit: () => {
      props.onExit();
    },
  });
  useEffect(() => {
    if (ready) open();
  }, [ready, open]);
  return (
    <p role="status" className="text-[12px] text-text-dim">
      Opening your secure bank connection…
    </p>
  );
}
