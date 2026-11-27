const usernamePattern = /^[a-z0-9_]{3,30}$/;

export function normalizeProfileQrUsername(value: string | null | undefined): string | null {
  const username = value?.trim().replace(/^@/, "").toLowerCase();
  return username && usernamePattern.test(username) ? username : null;
}

export function createProfileQrLink(username: string, origin: string): string {
  const normalizedUsername = normalizeProfileQrUsername(username);
  if (!normalizedUsername) throw new Error("A valid ConnectSphere username is required.");

  const profileUrl = new URL("/", origin);
  profileUrl.searchParams.set("connect", normalizedUsername);
  return profileUrl.toString();
}

export function getConnectUsername(value: string, origin: string): string | null {
  const directUsername = normalizeProfileQrUsername(value);
  if (directUsername) return directUsername;

  try {
    const url = new URL(value);
    if (url.origin !== new URL(origin).origin) return null;

    const queryUsername = normalizeProfileQrUsername(url.searchParams.get("connect"));
    if (queryUsername) return queryUsername;

    const pathMatch = /^\/u\/([^/]+)\/?$/.exec(url.pathname);
    return normalizeProfileQrUsername(pathMatch?.[1]);
  } catch {
    return null;
  }
}
