/**
 * Shared constants for the TempLink chat system.
 */

export const BROKERS = [
  "wss://broker.emqx.io:8084/mqtt",
  "wss://broker.hivemq.com:8884/mqtt",
  "wss://test.mosquitto.org:8081",
] as const;

export const TOPIC_PREFIX = "tmplink/v1";

// ── MQTT mode file transfer (safe for public brokers) ──────────────────────
export const CHUNK_SIZE = 8 * 1024; // 8 KB per chunk
export const CHUNK_DELAY = 200; // 200ms between chunks (broker rate limit)

// ── Server mode file transfer (custom WebSocket server — no limits) ────────
export const SERVER_CHUNK_SIZE = 128 * 1024; // 128 KB per chunk (16x larger)
export const SERVER_CHUNK_DELAY = 0; // No delay — WS/TCP handles flow control

export const CONNECT_TIMEOUT = 12_000;
export const RECONNECT_DELAY = 3_000;
export const ANNOUNCE_TIMES = 5;
export const ANNOUNCE_GAP = 800;
export const HEARTBEAT_INTERVAL = 15_000;
export const PEER_TIMEOUT = 45_000;
