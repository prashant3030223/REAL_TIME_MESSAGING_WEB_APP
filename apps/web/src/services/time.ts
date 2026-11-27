function isSameLocalDay(left: Date, right: Date): boolean {
  return left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate();
}

function startOfWeek(date: Date): Date {
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const daysSinceMonday = (start.getDay() + 6) % 7;
  start.setDate(start.getDate() - daysSinceMonday);
  return start;
}

function parseTimestamp(timestamp: string): Date | null {
  const parsed = new Date(timestamp);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function formatCallTimestamp(timestamp: string, now = new Date()): string {
  const date = parseTimestamp(timestamp);
  if (!date) return "Time unavailable";

  if (isSameLocalDay(date, now)) {
    return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  }

  if (date >= startOfWeek(now)) {
    return date.toLocaleDateString([], { weekday: "long" });
  }

  return date.toLocaleDateString([], { day: "numeric", month: "short", year: "numeric" });
}

export function formatLastSeen(timestamp: string | undefined, now = new Date()): string {
  if (!timestamp || timestamp === "Offline") return "Offline";
  if (timestamp === "Online now") return timestamp;

  const date = parseTimestamp(timestamp);
  if (!date) return timestamp;

  const elapsedMinutes = Math.max(0, Math.floor((now.getTime() - date.getTime()) / 60_000));
  if (elapsedMinutes < 1) return "Last seen just now";
  if (elapsedMinutes < 60) {
    return `Last seen ${elapsedMinutes} ${elapsedMinutes === 1 ? "minute" : "minutes"} ago`;
  }

  const elapsedHours = Math.floor(elapsedMinutes / 60);
  if (elapsedHours < 24) {
    return `Last seen ${elapsedHours} ${elapsedHours === 1 ? "hour" : "hours"} ago`;
  }

  if (isSameLocalDay(date, new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1))) {
    return `Last seen yesterday at ${date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
  }

  return `Last seen ${date.toLocaleDateString([], { day: "numeric", month: "short", year: "numeric" })}`;
}
