/**
 * useCall — voice/video call orchestrator.
 *
 * Strategy:
 *  1. Always try WebRTC first (best quality, P2P)
 *  2. If ICE fails AND we're in server mode:
 *     → Stop WebRTC
 *     → Start WS audio relay through the existing server WebSocket
 *     → Video calls degrade to audio-only (WS can't handle video bandwidth)
 *  3. Sends 'call-relay-fallback' signal so the OTHER side also switches
 *     immediately instead of waiting for its own ICE timeout.
 *
 * FIX: Removed isVoiceCall restriction — fallback now works for ALL call types.
 * FIX: Added 'call-relay-fallback' signal for coordinated switching.
 * FIX: Better error messages when no fallback is available (MQTT mode).
 */

import { useState, useRef, useCallback } from "react";
import { v4 as uuidv4 } from "uuid";
import { useWebRTC } from "./call/useWebRTC";
import { useWsAudioRelay } from "./call/useWsAudioRelay";
import type {
  ActiveCall,
  CallType,
  SignalPayload,
  SignalAction,
} from "./call/types";

interface UseCallOptions {
  myId: () => string;
  myName: () => string;
  sendSignal: (payload: SignalPayload) => void;
  getMode: () => "server" | "mqtt" | null;
  getWs: () => WebSocket | null;
}

export function useCall({
  myId,
  myName,
  sendSignal,
  getMode,
  getWs,
}: UseCallOptions) {
  const [activeCall, setActiveCall] = useState<ActiveCall | null>(null);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [isAudioMuted, setIsAudioMuted] = useState(false);
  const [isVideoMuted, setIsVideoMuted] = useState(false);
  const [callError, setCallError] = useState<string | null>(null);

  const incomingSignalRef = useRef<SignalPayload | null>(null);
  const activeCallRef = useRef<ActiveCall | null>(null);
  const errorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const callModeRef = useRef<"webrtc" | "ws-relay">("webrtc");
  const micStreamRef = useRef<MediaStream | null>(null);

  const syncActiveCall = useCallback((call: ActiveCall | null) => {
    activeCallRef.current = call;
    setActiveCall(call);
  }, []);

  const showError = useCallback((msg: string, duration = 5000) => {
    if (errorTimerRef.current) clearTimeout(errorTimerRef.current);
    setCallError(msg);
    errorTimerRef.current = setTimeout(() => {
      setCallError(null);
      errorTimerRef.current = null;
    }, duration);
  }, []);

  const wsRelay = useWsAudioRelay();

  // ── Cleanup ──────────────────────────────────────────────────────────────
  const cleanupCall = useCallback(() => {
    wsRelay.stop();
    micStreamRef.current?.getTracks().forEach((t) => t.stop());
    micStreamRef.current = null;
    syncActiveCall(null);
    setLocalStream(null);
    setRemoteStream(null);
    setIsAudioMuted(false);
    setIsVideoMuted(false);
    incomingSignalRef.current = null;
    callModeRef.current = "webrtc";
  }, [syncActiveCall, wsRelay]);

  // ── WS relay fallback ──────────────────────────────────────────────────
  const startWsRelayFallback = useCallback(async () => {
    const call = activeCallRef.current;
    const ws = getWs();

    if (!call || !ws || ws.readyState !== WebSocket.OPEN) {
      console.error("[Call] Cannot start WS relay — no call or no WebSocket");
      cleanupCall();
      showError("Call failed — could not establish connection");
      return;
    }

    console.log("[Call] 🔄 Starting WebSocket audio relay fallback...");
    callModeRef.current = "ws-relay";

    // Notify user — video calls degrade to audio-only
    if (call.type === "video") {
      showError(
        "Direct connection failed — switching to voice via server relay",
        4000,
      );
    } else {
      showError("Using server relay (direct P2P failed)", 3000);
    }

    try {
      // Get a FRESH mic stream (WebRTC may have destroyed the old one)
      let stream = micStreamRef.current;
      if (
        !stream ||
        stream.getAudioTracks().every((t) => t.readyState === "ended")
      ) {
        console.log("[Call] Getting fresh mic stream for WS relay...");
        stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
          video: false,
        });
        micStreamRef.current = stream;
      }

      setLocalStream(stream);

      // Start the WS audio relay
      wsRelay.start(ws, stream);

      // Set a remote stream for the UI (so CallScreen shows active state)
      const fakeRemote = wsRelay.getRemoteStream();
      if (fakeRemote) setRemoteStream(fakeRemote);

      // Always show as voice call (WS relay = audio only)
      syncActiveCall({
        ...call,
        type: "voice", // ← degrade to voice — WS can't relay video
        state: "active",
        startedAt: call.startedAt || Date.now(),
      });

      console.log("[Call] ✅ WS audio relay active!");
    } catch (err) {
      console.error("[Call] WS relay fallback failed:", err);
      showError("Call failed — microphone access denied");
      cleanupCall();
    }
  }, [getWs, cleanupCall, showError, wsRelay, syncActiveCall]);

  // ── WebRTC engine ────────────────────────────────────────────────────────
  const {
    localStreamRef: _localStreamRef,
    hasConnectedRef,
    startCall: rtcStartCall,
    acceptCall: rtcAcceptCall,
    handleAnswer,
    handleIce,
    setAudioMuted: rtcSetAudioMuted,
    setVideoMuted: rtcSetVideoMuted,
    destroy: rtcDestroy,
  } = useWebRTC({
    onSignal: (payload: SignalPayload) => {
      console.log("[Call] Sending signal:", payload.action);
      sendSignal(payload);
    },

    onRemoteStream: (stream: MediaStream) => {
      console.log(
        "[Call] 🔊 Remote stream — tracks:",
        stream.getTracks().map((t) => `${t.kind}:${t.readyState}`),
      );
      setRemoteStream(stream);
    },

    /**
     * ✅ FIXED: onEnded now falls back to WS relay for ALL call types
     * (voice AND video) when in server mode. Video degrades to audio-only.
     */
    onEnded: () => {
      console.log(
        "[Call] WebRTC ended — hasConnected:",
        hasConnectedRef.current,
        "| mode:",
        getMode(),
        "| callMode:",
        callModeRef.current,
      );

      // If WS relay is already running, ignore WebRTC ending
      if (callModeRef.current === "ws-relay") {
        console.log("[Call] WS relay active — ignoring WebRTC end");
        return;
      }

      const call = activeCallRef.current;
      if (!call) return;

      const neverConnected = !hasConnectedRef.current;
      const isServerMode = getMode() === "server";

      // ✅ FIX: Fall back for ALL call types when server is available
      if (neverConnected && isServerMode) {
        console.log(
          "[Call] 🔄 WebRTC P2P failed — falling back to WS audio relay",
          `(${call.type} call → voice relay)`,
        );

        // Tell the OTHER side to also switch to WS relay immediately
        // so they don't have to wait for their own ICE timeout
        sendSignal({
          action: "call-relay-fallback",
          callId: call.callId,
          fromId: myId(),
          fromName: myName(),
          callType: call.type,
        });

        rtcDestroy();
        startWsRelayFallback();
        return;
      }

      // ✅ FIX: Better error message when no fallback available
      if (neverConnected && !isServerMode) {
        console.error("[Call] P2P failed & no server for relay fallback");
        showError(
          "Call failed — direct connection blocked by your network. " +
            "Use a custom server for relay fallback.",
          8000,
        );
      }

      // Normal end (was connected, then dropped)
      console.log("[Call] Call ended");
      rtcDestroy();
      cleanupCall();
    },
  });

  // ── INITIATE a call ──────────────────────────────────────────────────────
  const startCall = useCallback(
    async (peerId: string, peerName: string, type: CallType) => {
      if (activeCallRef.current) {
        showError("Already in a call");
        return;
      }

      setCallError(null);
      callModeRef.current = "webrtc";
      const callId = uuidv4();

      syncActiveCall({
        callId,
        type,
        peer: { id: peerId, name: peerName },
        state: "calling",
        isCaller: true,
      });

      try {
        const stream = await rtcStartCall(callId, myId(), myName(), type);
        setLocalStream(stream);
        console.log("[Call] Started — waiting for answer...");
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        showError(
          msg.toLowerCase().includes("permission") ||
            msg.toLowerCase().includes("allowed")
            ? `Microphone${type === "video" ? "/camera" : ""} permission denied.`
            : `Could not start call: ${msg}`,
        );
        rtcDestroy();
        cleanupCall();
      }
    },
    [
      myId,
      myName,
      rtcStartCall,
      rtcDestroy,
      cleanupCall,
      syncActiveCall,
      showError,
    ],
  );

  // ── ACCEPT incoming call ─────────────────────────────────────────────────
  const acceptCall = useCallback(async () => {
    const signal = incomingSignalRef.current;
    if (!signal) {
      showError("No signal received.");
      cleanupCall();
      return;
    }
    if (!signal.sdp) {
      showError("No offer received. Ask them to call again.");
      sendSignal({
        action: "call-reject",
        callId: signal.callId,
        fromId: myId(),
        fromName: myName(),
        callType: signal.callType,
      });
      cleanupCall();
      rtcDestroy();
      return;
    }

    setCallError(null);
    callModeRef.current = "webrtc";

    syncActiveCall({
      callId: signal.callId,
      type: signal.callType,
      peer: { id: signal.fromId, name: signal.fromName },
      state: "active",
      isCaller: false,
      startedAt: Date.now(),
    });

    try {
      const stream = await rtcAcceptCall(signal, myId(), myName());
      setLocalStream(stream);
      console.log("[Call] Accepted — WebRTC connecting...");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      showError(
        msg.toLowerCase().includes("permission") ||
          msg.toLowerCase().includes("allowed")
          ? `Microphone${signal.callType === "video" ? "/camera" : ""} permission denied.`
          : `Could not join call: ${msg}`,
      );
      sendSignal({
        action: "call-reject",
        callId: signal.callId,
        fromId: myId(),
        fromName: myName(),
        callType: signal.callType,
      });
      rtcDestroy();
      cleanupCall();
    }
  }, [
    myId,
    myName,
    rtcAcceptCall,
    sendSignal,
    rtcDestroy,
    cleanupCall,
    syncActiveCall,
    showError,
  ]);

  // ── REJECT ───────────────────────────────────────────────────────────────
  const rejectCall = useCallback(() => {
    const signal = incomingSignalRef.current;
    if (signal) {
      sendSignal({
        action: "call-reject",
        callId: signal.callId,
        fromId: myId(),
        fromName: myName(),
        callType: signal.callType,
      });
    }
    rtcDestroy();
    cleanupCall();
  }, [myId, myName, sendSignal, rtcDestroy, cleanupCall]);

  // ── HANG UP ──────────────────────────────────────────────────────────────
  const hangup = useCallback(() => {
    const call = activeCallRef.current;
    if (call) {
      sendSignal({
        action: "call-hangup",
        callId: call.callId,
        fromId: myId(),
        fromName: myName(),
        callType: call.type,
      });
    }
    rtcDestroy();
    cleanupCall();
  }, [myId, myName, sendSignal, rtcDestroy, cleanupCall]);

  // ── Toggle audio ─────────────────────────────────────────────────────────
  const toggleAudio = useCallback(() => {
    setIsAudioMuted((prev) => {
      const next = !prev;
      rtcSetAudioMuted(next);
      wsRelay.setMuted(next);
      micStreamRef.current?.getAudioTracks().forEach((t) => {
        t.enabled = !next;
      });
      return next;
    });
  }, [rtcSetAudioMuted, wsRelay]);

  // ── Toggle video ─────────────────────────────────────────────────────────
  const toggleVideo = useCallback(() => {
    setIsVideoMuted((prev) => {
      const next = !prev;
      rtcSetVideoMuted(next);
      return next;
    });
  }, [rtcSetVideoMuted]);

  // ── Handle incoming signals ──────────────────────────────────────────────
  const handleCallSignal = useCallback(
    async (signal: SignalPayload) => {
      const me = myId();
      const action = signal.action as SignalAction;
      if (signal.fromId === me) return;

      console.log("[Call] Signal:", action, "| from:", signal.fromName);

      switch (action) {
        // ── Incoming call ring ──
        case "call-ring": {
          if (activeCallRef.current) {
            sendSignal({
              action: "call-busy",
              callId: signal.callId,
              fromId: me,
              fromName: myName(),
              callType: signal.callType,
            });
            return;
          }
          if (!signal.sdp) return;
          incomingSignalRef.current = signal;
          syncActiveCall({
            callId: signal.callId,
            type: signal.callType,
            peer: { id: signal.fromId, name: signal.fromName },
            state: "receiving",
            isCaller: false,
          });
          break;
        }

        // ── Answer received ──
        case "call-answer": {
          const call = activeCallRef.current;
          if (!call || call.callId !== signal.callId) break;
          try {
            await handleAnswer(signal);
            syncActiveCall({
              ...call,
              state: "active",
              startedAt: Date.now(),
            });
          } catch (err) {
            console.error("[Call] handleAnswer error:", err);
            showError("Call connection failed.");
            rtcDestroy();
            cleanupCall();
          }
          break;
        }

        // ── ICE candidate ──
        case "call-ice": {
          try {
            await handleIce(signal);
          } catch {
            /* */
          }
          break;
        }

        // ── Rejected ──
        case "call-reject": {
          const call = activeCallRef.current;
          if (!call || call.callId !== signal.callId) break;
          rtcDestroy();
          cleanupCall();
          showError(`${signal.fromName} declined the call.`);
          break;
        }

        // ── Busy ──
        case "call-busy": {
          const call = activeCallRef.current;
          if (!call || call.callId !== signal.callId) break;
          rtcDestroy();
          cleanupCall();
          showError(`${signal.fromName} is busy.`);
          break;
        }

        // ── Hangup ──
        case "call-hangup": {
          const call = activeCallRef.current;
          if (!call || call.callId !== signal.callId) break;
          rtcDestroy();
          cleanupCall();
          break;
        }

        // ── ✅ NEW: Peer switched to WS relay — follow them ──
        case "call-relay-fallback": {
          const call = activeCallRef.current;
          if (!call || call.callId !== signal.callId) break;

          // Already on relay? Do nothing
          if (callModeRef.current === "ws-relay") {
            console.log(
              "[Call] Received relay-fallback but already on WS relay",
            );
            break;
          }

          // Can only follow if we're in server mode
          const isServerMode = getMode() === "server";
          if (!isServerMode) {
            console.warn(
              "[Call] Received relay-fallback but not in server mode — ignoring",
            );
            break;
          }

          console.log(
            "[Call] 📡 Peer switched to WS relay — following immediately",
          );
          rtcDestroy();
          await startWsRelayFallback();
          break;
        }
      }
    },
    [
      myId,
      myName,
      sendSignal,
      handleAnswer,
      handleIce,
      rtcDestroy,
      cleanupCall,
      syncActiveCall,
      showError,
      getMode,
      startWsRelayFallback,
    ],
  );

  /** Handle binary WS message (audio from remote peer via server relay) */
  const handleBinaryMessage = useCallback(
    (data: ArrayBuffer) => {
      wsRelay.onBinaryMessage(data);
    },
    [wsRelay],
  );

  return {
    activeCall,
    localStream,
    remoteStream,
    isAudioMuted,
    isVideoMuted,
    callError,
    localStreamRef: _localStreamRef,
    startCall,
    acceptCall,
    rejectCall,
    hangup,
    toggleAudio,
    toggleVideo,
    handleCallSignal,
    handleBinaryMessage,
  };
}
