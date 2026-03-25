/**
 * Pure utility functions — no side effects, no state.
 *
 * FIX: roomLink() now optionally includes server URL for auto-fill.
 */

import { TOPIC_PREFIX } from "./constants";

/** Generate a random 6-character room code (no ambiguous chars). */
export function generateCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from(
    { length: 6 },
    () => chars[Math.floor(Math.random() * chars.length)],
  ).join("");
}

/** Human-readable file size. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Build all MQTT topic strings for a given room code. */
export function roomTopics(code: string) {
  const base = `${TOPIC_PREFIX}/${code}`;
  return {
    chat: `${base}/chat`,
    presence: `${base}/presence`,
    call: `${base}/call`,
    file: `${base}/file`,
  };
}

/**
 * Build the shareable room URL.
 * ✅ NEW: Optionally includes server URL so the recipient auto-connects
 *         to the same custom server without manual setup.
 *
 * Examples:
 *   roomLink("ABC123")
 *     → https://app.com?room=ABC123
 *
 *   roomLink("ABC123", "wss://myserver.com:3001")
 *     → https://app.com?room=ABC123&server=wss%3A%2F%2Fmyserver.com%3A3001
 */
export function roomLink(code: string, serverUrl?: string): string {
  let url = `${window.location.origin}${window.location.pathname}?room=${code}`;
  if (serverUrl && serverUrl.trim()) {
    url += `&server=${encodeURIComponent(serverUrl.trim())}`;
  }
  return url;
}
