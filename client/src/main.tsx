import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.tsx";
import { MantuaPrivyProvider } from "./lib/privy/provider.tsx";
import { ThemeProvider } from "./hooks/use-theme.tsx";
import { ConfirmProvider } from "./hooks/use-confirmed-action.tsx";

const root = document.getElementById("root");
if (!root) throw new Error("#root not found");

createRoot(root).render(
  <StrictMode>
    <ThemeProvider>
      <MantuaPrivyProvider>
        <ConfirmProvider>
          <App />
        </ConfirmProvider>
      </MantuaPrivyProvider>
    </ThemeProvider>
  </StrictMode>,
);
