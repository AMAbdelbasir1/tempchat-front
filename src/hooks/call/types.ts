/**
 * Call-related types for WebRTC voice/video over relay signaling.
 */

export type CallType = "voice" | "video";
export type CallState = "idle" | "calling" | "receiving" | "active" | "ended";

/** Signaling messages sent over the relay (encrypted) */
export type SignalAction =
  | "call-offer"
  | "call-answer"
  | "call-ice"
  | "call-reject"
  | "call-hangup"
  | "call-busy"
  | "call-ring"
  | "call-relay-fallback"; // ← NEW: tells peer to switch to WS relay

export interface SignalPayload {
  action: SignalAction;
  callId: string;
  fromId: string;
  fromName: string;
  callType: CallType;
  sdp?: RTCSessionDescriptionInit;
  ice?: RTCIceCandidateInit;
}

export interface CallParticipant {
  id: string;
  name: string;
}

export interface ActiveCall {
  callId: string;
  type: CallType;
  peer: CallParticipant;
  state: CallState;
  isCaller: boolean;
  startedAt?: number;
}
