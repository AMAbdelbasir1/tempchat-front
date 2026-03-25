/**
 * Internal payload types — these are the plaintext objects that get
 * AES-GCM encrypted before being published to the MQTT broker.
 *
 * The broker NEVER sees these in plain form.
 */

/** Encrypted wire envelope — what actually travels over MQTT. */
export interface WireEnvelope {
  v:   number;  // protocol version (always 1)
  enc: string;  // base64 AES-GCM ciphertext
}

/** Presence announcement — join / leave / ping / heartbeat. */
export interface PresencePayload {
  id:     string;
  name:   string;
  action: 'join' | 'leave' | 'ping' | 'heartbeat';
}

/** Per-peer tracking entry for heartbeat/timeout detection. */
export interface PeerEntry {
  name:      string;
  lastSeen:  number; // Date.now() of last heartbeat/ping/join
}

/** Text or link chat message. */
export interface ChatPayload {
  id:        string;
  from:      string;
  fromName:  string;
  msgType:   string;
  content:   string;
  timestamp: number;
}

/** One chunk of a file transfer. */
export interface FileChunkPayload {
  txId:        string;
  from:        string;
  fromName:    string;
  chunkIndex:  number;
  totalChunks: number;
  fileName:    string;
  fileType:    string;
  fileSize:    number;
  data:        string;   // base64 slice of the file
}

/** In-memory buffer while reassembling incoming chunks. */
export interface ChunkBuffer {
  fileName:    string;
  fileType:    string;
  fileSize:    number;
  totalChunks: number;
  fromName:    string;
  received:    Map<number, string>;
}
