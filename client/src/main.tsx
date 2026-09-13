import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.tsx";
import { MantuaPrivyProvider } from "./lib/privy/provider.tsx";
import { ThemeProvider } from "./hooks/use-theme.tsx";
import { ConfirmProvider } from "./hooks/use-confirmed-action.tsx";
import { PlatformStatusProvider } from "./features/status/PlatformStatusProvider.tsx";
import { PendingTradesProvider } from "./features/markets/PendingTradesProvider.tsx";

const root = document.getElementById("root");
if (!root) throw new Error("#root not found");

createRoot(root).render(
  <StrictMode>
    <ThemeProvider>
      <MantuaPrivyProvider>
        {/* Phase 7 — app-wide platform status (R-005) and the pending-trade
            register (R-004) sit above every surface, App's early returns
            included. */}
        <PlatformStatusProvider>
          <PendingTradesProvider>
            <ConfirmProvider>
              <App />
            </ConfirmProvider>
          </PendingTradesProvider>
        </PlatformStatusProvider>
      </MantuaPrivyProvider>
    </ThemeProvider>
  </StrictMode>,
);
