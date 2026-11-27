export type BrowserPushStatus = {
  supported: boolean;
  permission: NotificationPermission | "unsupported";
  subscribed: boolean;
  requiresHomeScreenInstall: boolean;
};

function isIosDevice(): boolean {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

function isStandalone(): boolean {
  return window.matchMedia?.("(display-mode: standalone)").matches === true ||
    ("standalone" in navigator &&
      (navigator as Navigator & { standalone?: boolean }).standalone === true);
}

function decodeApplicationServerKey(value: string): ArrayBuffer {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(
    Math.ceil(value.length / 4) * 4,
    "=",
  );
  const decoded = window.atob(padded);
  const buffer = new ArrayBuffer(decoded.length);
  const bytes = new Uint8Array(buffer);
  for (let index = 0; index < decoded.length; index += 1) {
    bytes[index] = decoded.charCodeAt(index);
  }
  return buffer;
}

async function readError(response: Response, fallback: string): Promise<string> {
  try {
    const result = await response.json() as { error?: { message?: string } };
    return result.error?.message || fallback;
  } catch {
    return fallback;
  }
}

export async function getBrowserPushStatus(): Promise<BrowserPushStatus> {
  const supported = typeof window !== "undefined" &&
    "Notification" in window &&
    "serviceWorker" in navigator &&
    "PushManager" in window;
  const requiresHomeScreenInstall =
    supported && isIosDevice() && !isStandalone();

  if (!supported) {
    return {
      supported: false,
      permission: "unsupported",
      subscribed: false,
      requiresHomeScreenInstall: false,
    };
  }

  const registration = await navigator.serviceWorker.ready;
  return {
    supported: true,
    permission: Notification.permission,
    subscribed: Boolean(await registration.pushManager.getSubscription()),
    requiresHomeScreenInstall,
  };
}

export async function enableBrowserPush(): Promise<void> {
  if (!window.isSecureContext) {
    throw new Error("Push notifications require ConnectSphere to be opened over HTTPS.");
  }

  const supported =
    "Notification" in window &&
    "serviceWorker" in navigator &&
    "PushManager" in window;
  if (!supported) {
    throw new Error("This browser does not support push notifications. Install ConnectSphere as a PWA or use a supported browser.");
  }
  if (isIosDevice() && !isStandalone()) {
    throw new Error("On iPhone or iPad, add ConnectSphere to your Home Screen first, then open the installed app to enable notifications.");
  }

  let permission = Notification.permission;
  if (permission === "default") permission = await Notification.requestPermission();
  if (permission !== "granted") {
    throw new Error(
      permission === "denied"
        ? "Notifications are blocked for ConnectSphere. Allow them in your browser or device settings."
        : "Notification permission was not granted.",
    );
  }

  const keyResponse = await fetch("/api/push/public-key");
  if (!keyResponse.ok) {
    throw new Error(await readError(keyResponse, "Push notifications are not configured on the server yet."));
  }
  const keyResult = await keyResponse.json() as { publicKey?: string };
  if (!keyResult.publicKey) throw new Error("The server did not provide a push notification key.");

  const registration = await navigator.serviceWorker.ready;
  let subscription = await registration.pushManager.getSubscription();
  let createdSubscription = false;
  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: decodeApplicationServerKey(keyResult.publicKey),
    });
    createdSubscription = true;
  }

  try {
    const response = await fetch("/api/push/subscriptions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(subscription.toJSON()),
    });
    if (!response.ok) {
      throw new Error(await readError(response, "Could not save this device for push notifications."));
    }
  } catch (error) {
    if (createdSubscription) await subscription.unsubscribe();
    throw error;
  }
}

export async function disableBrowserPush(): Promise<void> {
  const status = await getBrowserPushStatus();
  if (!status.supported) return;

  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.getSubscription();
  if (!subscription) return;

  const response = await fetch("/api/push/subscriptions", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ endpoint: subscription.endpoint }),
  });
  if (!response.ok) {
    throw new Error(await readError(response, "Could not remove this device's push subscription."));
  }
  if (!await subscription.unsubscribe()) {
    throw new Error("The browser could not disable push notifications for this device.");
  }
}
