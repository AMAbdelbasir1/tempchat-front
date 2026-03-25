export type MessageType = "text" | "file" | "system" | "link";

export interface FileAttachment {
  name: string;
  size: number;
  type: string;
  url: string;
  id: string;
}

export interface Message {
  id: string;
  type: MessageType;
  content: string;
  sender: "me" | "peer";
  senderName: string;
  timestamp: number;
  file?: FileAttachment;
  progress?: number;
  edited?: boolean; // ← NEW: shows "(edited)" indicator
  deleted?: boolean; // ← NEW: marks message as deleted
}

export interface Room {
  code: string;
  link: string;
  createdAt: number;
  peerCount: number;
}

export type ConnectionStatus =
  | "idle"
  | "connecting"
  | "connected"
  | "disconnected"
  | "error";
