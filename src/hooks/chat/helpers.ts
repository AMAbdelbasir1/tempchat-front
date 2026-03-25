/**
 * Pure utility functions — no side effects, no state.
 */

import { TOPIC_PREFIX } from './constants';

/** Generate a random 6-character room code (no ambiguous chars). */
export function generateCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from(
    { length: 6 },
    () => chars[Math.floor(Math.random() * chars.length)]
  ).join('');
}

/** Human-readable file size. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024)        return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Build all MQTT topic strings for a given room code. */
export function roomTopics(code: string) {
  const base = `${TOPIC_PREFIX}/${code}`;
  return {
    chat:      `${base}/chat`,
    presence:  `${base}/presence`,
    call:      `${base}/call`,
    file:      `${base}/file`,
  };
}

/** Build the shareable room URL. */
export function roomLink(code: string): string {
  return `${window.location.origin}${window.location.pathname}?room=${code}`;
}
