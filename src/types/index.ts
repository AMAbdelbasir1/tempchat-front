export type MessageType = 'text' | 'file' | 'system' | 'link';

export interface FileAttachment {
  name: string;
  size: number;
  type: string;
  url: string; // base64 or blob URL
  id: string;
}

export interface Message {
  id: string;
  type: MessageType;
  content: string;
  sender: 'me' | 'peer';
  senderName: string;
  timestamp: number;
  file?: FileAttachment;
  progress?: number; // 0-100 for file transfers, undefined = complete
}

export interface Room {
  code: string;
  link: string;
  createdAt: number;
  peerCount: number;
}

export type ConnectionStatus = 'idle' | 'connecting' | 'connected' | 'disconnected' | 'error';
