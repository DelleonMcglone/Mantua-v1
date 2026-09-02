import type { ReactNode } from "react";
import { PrivyProvider } from "@privy-io/react-auth";
import { PRIVY_APP_ID, privyConfig } from "./config.ts";

export function MantuaPrivyProvider({ children }: { children: ReactNode }) {
  // A missing app id would crash Privy → blank screen. Show a clear,
  // actionable message instead (the deploy is otherwise fine).
  if (!PRIVY_APP_ID) return <MissingPrivyConfig />;
  return (
    <PrivyProvider appId={PRIVY_APP_ID} config={privyConfig}>
      {children}
    </PrivyProvider>
  );
}

function MissingPrivyConfig() {
  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
        textAlign: "center",
      }}
    >
      <div style={{ maxWidth: 460 }}>
        <div style={{ fontSize: 18, fontWeight: 600, marginBottom: 10, color: "var(--text)" }}>
          Configuration needed
        </div>
        <p style={{ fontSize: 14, lineHeight: 1.65, color: "var(--text-dim)" }}>
          <code>VITE_PRIVY_APP_ID</code> isn't set. Add it (and the other <code>VITE_*</code>{" "}
          variables from <code>client/.env.example</code>) to this project's Environment Variables
          in Vercel, then redeploy.
        </p>
      </div>
    </div>
  );
}
