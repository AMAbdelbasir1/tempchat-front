/**
 * Internal payload types.
 *
 * NEW: ChatPayload now supports 'edit' and 'delete' msgTypes
 *      with optional editMsgId field.
 */

/** Encrypted wire envelope */
export interface WireEnvelope {
  v: number;
  enc: string;
}

/** Presence announcement */
export interface PresencePayload {
  id: string;
  name: string;
  action: "join" | "leave" | "ping" | "heartbeat";
}

/** Per-peer tracking entry */
export interface PeerEntry {
  name: string;
  lastSeen: number;
}

/** Text, link, edit, or delete chat message */
export interface ChatPayload {
  id: string;
  from: string;
  fromName: string;
  msgType: string; // 'text' | 'link' | 'edit' | 'delete'
  content: string;
  timestamp: number;
  editMsgId?: string; // ← NEW: for edit/delete, the target message ID
}

/** One chunk of a file transfer */
export interface FileChunkPayload {
  txId: string;
  from: string;
  fromName: string;
  chunkIndex: number;
  totalChunks: number;
  fileName: string;
  fileType: string;
  fileSize: number;
  data: string;
}

/** In-memory buffer while reassembling incoming chunks */
export interface ChunkBuffer {
  fileName: string;
  fileType: string;
  fileSize: number;
  totalChunks: number;
  fromName: string;
  received: Map<number, string>;
}
