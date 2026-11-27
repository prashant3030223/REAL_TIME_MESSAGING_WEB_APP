import { useEffect, useState } from "react";
import { Download, Share2, X } from "lucide-react";

type InstallChoice = {
  outcome: "accepted" | "dismissed";
  platform: string;
};

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<InstallChoice>;
};

function isAppInstalled(): boolean {
  const isStandalone = window.matchMedia?.("(display-mode: standalone)").matches;
  const isIosStandalone =
    "standalone" in navigator &&
    (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return Boolean(isStandalone || isIosStandalone);
}

function isIosDevice(): boolean {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

export function PwaInstallPrompt() {
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isInstalled, setIsInstalled] = useState(false);
  const [isDismissed, setIsDismissed] = useState(false);
  const [showInstructions, setShowInstructions] = useState(false);
  const [installError, setInstallError] = useState<string | null>(null);

  useEffect(() => {
    setIsInstalled(isAppInstalled());

    const handleBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as BeforeInstallPromptEvent);
    };
    const handleAppInstalled = () => {
      setIsInstalled(true);
      setInstallPrompt(null);
    };

    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    window.addEventListener("appinstalled", handleAppInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
      window.removeEventListener("appinstalled", handleAppInstalled);
    };
  }, []);

  async function handleInstall() {
    setInstallError(null);
    if (!installPrompt) {
      setShowInstructions((visible) => !visible);
      return;
    }

    try {
      await installPrompt.prompt();
      const choice = await installPrompt.userChoice;
      setInstallPrompt(null);
      if (choice.outcome === "accepted") {
        setIsInstalled(true);
      } else {
        setShowInstructions(true);
      }
    } catch (error) {
      setInstallError(
        error instanceof Error ? error.message : "The install prompt could not be opened."
      );
    }
  }

  if (isInstalled || isDismissed) return null;

  const requiresHttps =
    !window.isSecureContext && !["localhost", "127.0.0.1"].includes(window.location.hostname);

  return (
    <aside className="pwa-install-banner" aria-label="Install ConnectSphere">
      <button
        type="button"
        className="pwa-install-dismiss"
        onClick={() => setIsDismissed(true)}
        aria-label="Dismiss install option"
      >
        <X size={17} />
      </button>
      <div className="pwa-install-copy">
        <strong>Use ConnectSphere like an app</strong>
        <p>Install it for quick access from your home screen.</p>
      </div>
      <button type="button" className="pwa-install-action" onClick={() => void handleInstall()}>
        <Download size={16} />
        Install
      </button>
      {showInstructions && (
        <div className="pwa-install-instructions" role="status">
          {requiresHttps ? (
            <p>App installation needs a secure HTTPS website. Open ConnectSphere from its HTTPS address to install.</p>
          ) : isIosDevice() ? (
            <p>
              In Safari, tap <Share2 size={14} aria-label="Share" /> <strong>Share</strong>, then choose{" "}
              <strong>Add to Home Screen</strong>.
            </p>
          ) : (
            <p>
              Direct installation is not available in this browser yet. Open the HTTPS site in Chrome or Edge,
              then reload and tap Install.
            </p>
          )}
        </div>
      )}
      {installError && <p className="pwa-install-error" role="alert">{installError}</p>}
    </aside>
  );
}
