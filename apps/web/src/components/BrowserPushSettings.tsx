import { useEffect, useState } from "react";
import {
  disableBrowserPush,
  enableBrowserPush,
  getBrowserPushStatus,
  type BrowserPushStatus,
} from "../services/pushNotifications.js";

export function BrowserPushSettings() {
  const [status, setStatus] = useState<BrowserPushStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    void getBrowserPushStatus().then(
      (nextStatus) => {
        if (active) setStatus(nextStatus);
      },
      (reason: unknown) => {
        if (active) {
          setError(reason instanceof Error ? reason.message : "Could not check notification support.");
        }
      },
    );
    return () => {
      active = false;
    };
  }, []);

  async function toggleNotifications() {
    setBusy(true);
    setError(null);
    try {
      if (status?.subscribed) {
        await disableBrowserPush();
      } else {
        await enableBrowserPush();
      }
      setStatus(await getBrowserPushStatus());
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not update notification settings.");
      try {
        setStatus(await getBrowserPushStatus());
      } catch (statusError) {
        setError(
          statusError instanceof Error
            ? statusError.message
            : "Could not check notification support.",
        );
      }
    } finally {
      setBusy(false);
    }
  }

  const supported = status?.supported ?? true;
  const blocked = status?.permission === "denied";

  return (
    <div className="toggle-setting-row">
      <div>
        <strong>Message &amp; Call Notifications</strong>
        <p>
          {status?.requiresHomeScreenInstall
            ? "On iPhone or iPad, add ConnectSphere to your Home Screen, then open the installed app."
            : blocked
              ? "Notifications are blocked. Allow them in your browser or device settings."
              : status?.subscribed
                ? "This device can receive message alerts and incoming-call notifications in the background."
                : "Allow alerts for new messages and incoming calls when ConnectSphere is in the background."}
        </p>
        {error && <p role="alert">{error}</p>}
      </div>
      <button
        type="button"
        className={status?.subscribed ? "secondary-btn" : "primary-btn"}
        onClick={() => void toggleNotifications()}
        disabled={busy || !supported || blocked || Boolean(status?.requiresHomeScreenInstall)}
      >
        {busy
          ? "Updating..."
          : status?.subscribed
            ? "Turn off"
            : supported
              ? "Enable notifications"
              : "Not supported"}
      </button>
    </div>
  );
}
