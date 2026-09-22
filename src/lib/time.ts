import type { AppTimestamp } from "../types";

export const APP_TIMEZONE = "Europe/London";

export function toDate(value: AppTimestamp): Date | null {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value === "number" || typeof value === "string") return new Date(value);
  if ("toDate" in value && typeof value.toDate === "function") return value.toDate();
  return null;
}

export function toInputDateTime(value: AppTimestamp): string {
  const date = toDate(value);
  if (!date) return "";
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

export function formatDate(value: AppTimestamp, options?: Intl.DateTimeFormatOptions): string {
  const date = toDate(value);
  if (!date) return "Not set";
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: APP_TIMEZONE,
    ...options,
  }).format(date);
}

export function formatDateRange(start: AppTimestamp, end: AppTimestamp): string {
  const startDate = formatDate(start, { day: "numeric", month: "short" });
  const endDate = formatDate(end, { day: "numeric", month: "short", year: "numeric" });
  return `${startDate} - ${endDate}`;
}

export function formatTimeAgo(value: AppTimestamp): string {
  const date = toDate(value);
  if (!date) return "just now";
  const seconds = Math.max(1, Math.floor((Date.now() - date.getTime()) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return formatDate(date, { day: "numeric", month: "short" });
}

export function getCountdownParts(end: AppTimestamp, now = Date.now()) {
  const endDate = toDate(end);
  const total = endDate ? Math.max(0, endDate.getTime() - now) : 0;
  const days = Math.floor(total / 86400000);
  const hours = Math.floor((total % 86400000) / 3600000);
  const minutes = Math.floor((total % 3600000) / 60000);
  const seconds = Math.floor((total % 60000) / 1000);
  return { total, days, hours, minutes, seconds, expired: total <= 0 };
}

export function formatCountdown(end: AppTimestamp, now = Date.now(), withSeconds = true): string {
  const parts = getCountdownParts(end, now);
  if (parts.expired) return "Challenge complete";
  const dayPart = parts.days > 0 ? `${parts.days}d ` : "";
  const secondPart = withSeconds ? ` ${String(parts.seconds).padStart(2, "0")}s` : "";
  return `${dayPart}${String(parts.hours).padStart(2, "0")}h ${String(parts.minutes).padStart(2, "0")}m${secondPart}`;
}

export function yearFromDate(value: AppTimestamp): number {
  const date = toDate(value) ?? new Date();
  return Number(new Intl.DateTimeFormat("en-GB", { year: "numeric", timeZone: APP_TIMEZONE }).format(date));
}
