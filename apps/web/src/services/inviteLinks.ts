const usernamePattern = /^[a-z0-9_]{3,30}$/i;

export type InviteShareResult = "shared" | "copied" | "cancelled" | "manual";

export function createInviteLink(username: string, origin: string): string {
  const inviter = username.trim().replace(/^@/, "").toLowerCase();
  if (!usernamePattern.test(inviter)) {
    throw new Error("A valid username is required to create an invite link.");
  }

  const inviteUrl = new URL("/", origin);
  inviteUrl.searchParams.set("invite", inviter);
  return inviteUrl.toString();
}

export function getInviterUsername(search: string): string | null {
  const inviter = new URLSearchParams(search).get("invite")?.trim().replace(/^@/, "").toLowerCase();
  return inviter && usernamePattern.test(inviter) ? inviter : null;
}

function isShareCanceled(error: unknown): boolean {
  return typeof error === "object" && error !== null && "name" in error && error.name === "AbortError";
}

export async function shareInviteUrl(url: string): Promise<InviteShareResult> {
  if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
    try {
      await navigator.share({
        title: "Join me on ConnectSphere",
        text: "Connect with me on ConnectSphere.",
        url,
      });
      return "shared";
    } catch (error) {
      if (isShareCanceled(error)) return "cancelled";
    }
  }

  if (typeof navigator === "undefined" || typeof navigator.clipboard?.writeText !== "function") {
    return "manual";
  }

  try {
    await navigator.clipboard.writeText(url);
    return "copied";
  } catch {
    return "manual";
  }
}
