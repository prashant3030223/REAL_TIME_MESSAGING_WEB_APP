import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.js";
import "./styles.css";

if (import.meta.env.PROD && "serviceWorker" in navigator && window.isSecureContext) {
  void navigator.serviceWorker.register("/sw.js").catch((error: unknown) => {
    console.error("Could not register the ConnectSphere service worker:", error);
  });
}

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Root element is missing.");
}

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);