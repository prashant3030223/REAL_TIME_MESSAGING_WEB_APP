// ConnectSphere Production Service Worker
const CACHE_NAME = "connect-sphere-v2";
const STATIC_ASSETS = [
  "/",
  "/index.html",
  "/icon.svg",
  "/icon-180.png",
  "/icon-192.png",
  "/icon-512.png",
  "/manifest.webmanifest",
];

// Install Event - Precache critical shell
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS).catch((err) => {
        console.warn("Pre-caching some assets skipped:", err);
      });
    }).then(() => self.skipWaiting())
  );
});

// Activate Event - Clean up stale caches
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch Event - Stale-while-revalidate for static files, Network-first for API
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // Never intercept WebSocket or API calls
  if (url.pathname.startsWith("/ws") || url.pathname.startsWith("/api/")) {
    return;
  }

  // Non-GET requests (e.g. POST) bypass cache
  if (event.request.method !== "GET") {
    return;
  }

  // Navigation requests (HTML SPA fallback)
  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request).catch(async () => {
        const cached = await caches.match("/index.html");
        return cached || new Response("ConnectSphere is currently offline.", {
          status: 503,
          headers: { "Content-Type": "text/html" },
        });
      })
    );
    return;
  }

  // Cache-first / Stale-while-revalidate for static assets
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      const fetchPromise = fetch(event.request)
        .then((networkResponse) => {
          if (
            networkResponse &&
            networkResponse.status === 200 &&
            (url.pathname.startsWith("/assets/") || url.pathname.endsWith(".svg") || url.pathname.endsWith(".css") || url.pathname.endsWith(".js"))
          ) {
            const responseToCache = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, responseToCache);
            });
          }
          return networkResponse;
        })
        .catch(() => cachedResponse);

      return cachedResponse || fetchPromise;
    })
  );
});

// Push Notification Handling
self.addEventListener("push", (event) => {
  let data = {
    type: "message",
    title: "ConnectSphere",
    body: "New activity incoming.",
    icon: "/icon.svg",
    url: "/",
  };
  try {
    if (event.data) {
      data = { ...data, ...event.data.json() };
    }
  } catch (error) {
    console.warn("Could not parse a push notification payload:", error);
  }

  if (data.type === "call-ended") {
    const tag = data.tag || `call-${data.callId || "incoming"}`;
    event.waitUntil(
      self.registration.getNotifications({ tag }).then((notifications) => {
        for (const notification of notifications) notification.close();
      })
    );
    return;
  }

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      if (clientList.some((client) => client.visibilityState === "visible")) return;

      const isCall = data.type === "call";
      return self.registration.showNotification(data.title || "ConnectSphere", {
        body: data.body || "New activity incoming.",
        icon: data.icon || "/icon.svg",
        badge: "/icon.svg",
        vibrate: isCall ? [250, 120, 250, 120, 500] : [100, 50, 100],
        requireInteraction: isCall,
        tag: data.tag || (isCall ? `call-${data.callId || "incoming"}` : undefined),
        renotify: isCall,
        data: {
          ...data,
          url: data.url || "/",
        },
      });
    })
  );
});

// Notification Click -> Focus or Open Client
self.addEventListener("notificationclick", (event) => {
  const notificationData = event.notification.data || {};
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(async (clientList) => {
      const requestedUrl = new URL(notificationData.url || "/", self.location.origin);
      const targetUrl = requestedUrl.origin === self.location.origin
        ? requestedUrl.href
        : self.location.origin + "/";
      for (const client of clientList) {
        if ("focus" in client) {
          if (client.url !== targetUrl && "navigate" in client) {
            await client.navigate(targetUrl);
          }
          client.postMessage({ type: "push-notification-click", payload: notificationData });
          return client.focus();
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }
    })
  );
});
