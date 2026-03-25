/**
 * useWsAudioRelay — Voice call via WebSocket binary relay.
 *
 * FIX: Added AudioContext.resume() for mobile autoplay policy.
 * FIX: Better error handling and reconnection resilience.
 *
 * Used as FALLBACK when WebRTC P2P fails (e.g. mobile carrier NAT).
 * Audio: Mic → AudioContext → PCM Int16 → WS → Server → WS → AudioContext → Speaker
 */

import { useRef, useCallback } from "react";

const SAMPLE_RATE = 16000;
const BUFFER_SIZE = 4096;
const JITTER_BUFFER_MS = 150;

export function useWsAudioRelay() {
  const audioContextRef = useRef<AudioContext | null>(null);
  const playContextRef = useRef<AudioContext | null>(null);
  const sourceNodeRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const activeRef = useRef(false);
  const nextPlayTimeRef = useRef(0);
  const statsRef = useRef({ sent: 0, received: 0, dropped: 0 });

  /**
   * Ensure an AudioContext is in "running" state.
   * Mobile browsers suspend AudioContext until user gesture.
   */
  const ensureContextRunning = useCallback(async (ctx: AudioContext) => {
    if (ctx.state === "suspended") {
      try {
        await ctx.resume();
        console.log("[WsRelay] AudioContext resumed from suspended state");
      } catch (e) {
        console.warn("[WsRelay] AudioContext resume failed:", e);
      }
    }
  }, []);

  /**
   * Start capturing audio from localStream and sending via WebSocket.
   * Also start receiving and playing audio from the WebSocket.
   */
  const start = useCallback(
    (ws: WebSocket, localStream: MediaStream) => {
      if (activeRef.current) {
        console.warn("[WsRelay] Already active — stopping previous session");
        // Stop previous session first
        stopInternal();
      }

      activeRef.current = true;
      wsRef.current = ws;
      localStreamRef.current = localStream;
      statsRef.current = { sent: 0, received: 0, dropped: 0 };

      console.log("[WsRelay] Starting audio relay");
      console.log(
        "[WsRelay] Local tracks:",
        localStream
          .getAudioTracks()
          .map((t) => `${t.kind}:${t.readyState}:enabled=${t.enabled}`),
      );

      // ── CAPTURE: Mic → PCM → WebSocket ──────────────────────
      try {
        const captureCtx = new AudioContext({ sampleRate: SAMPLE_RATE });
        audioContextRef.current = captureCtx;

        // Resume for mobile
        ensureContextRunning(captureCtx);

        const source = captureCtx.createMediaStreamSource(localStream);
        sourceNodeRef.current = source;

        const processor = captureCtx.createScriptProcessor(BUFFER_SIZE, 1, 1);
        processorRef.current = processor;

        processor.onaudioprocess = (e) => {
          if (
            !activeRef.current ||
            !wsRef.current ||
            wsRef.current.readyState !== WebSocket.OPEN
          )
            return;

          const input = e.inputBuffer.getChannelData(0);

          // Float32 → Int16
          const int16 = new Int16Array(input.length);
          for (let i = 0; i < input.length; i++) {
            const s = Math.max(-1, Math.min(1, input[i]));
            int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
          }

          wsRef.current.send(int16.buffer);
          statsRef.current.sent++;
        };

        source.connect(processor);
        processor.connect(captureCtx.destination);

        console.log(
          "[WsRelay] Capture started — sample rate:",
          SAMPLE_RATE,
          "buffer:",
          BUFFER_SIZE,
        );
      } catch (err) {
        console.error("[WsRelay] Capture setup error:", err);
      }

      // ── PLAYBACK: WebSocket → PCM → Speaker ────────────────
      try {
        const playCtx = new AudioContext({ sampleRate: SAMPLE_RATE });
        playContextRef.current = playCtx;
        nextPlayTimeRef.current = 0;

        // Resume for mobile autoplay policy
        ensureContextRunning(playCtx);

        console.log(
          "[WsRelay] Playback context created — sample rate:",
          playCtx.sampleRate,
          "state:",
          playCtx.state,
        );
      } catch (err) {
        console.error("[WsRelay] Playback setup error:", err);
      }
    },
    [ensureContextRunning],
  );

  // Internal stop without logging (used by start when restarting)
  const stopInternal = useCallback(() => {
    activeRef.current = false;

    if (processorRef.current) {
      processorRef.current.onaudioprocess = null;
      try {
        processorRef.current.disconnect();
      } catch {
        /* */
      }
      processorRef.current = null;
    }
    if (sourceNodeRef.current) {
      try {
        sourceNodeRef.current.disconnect();
      } catch {
        /* */
      }
      sourceNodeRef.current = null;
    }
    if (audioContextRef.current) {
      try {
        audioContextRef.current.close();
      } catch {
        /* */
      }
      audioContextRef.current = null;
    }
    if (playContextRef.current) {
      try {
        playContextRef.current.close();
      } catch {
        /* */
      }
      playContextRef.current = null;
    }

    wsRef.current = null;
    localStreamRef.current = null;
    nextPlayTimeRef.current = 0;
  }, []);

  /**
   * Called when a binary WebSocket frame arrives (audio from remote peer).
   */
  const onBinaryMessage = useCallback((data: ArrayBuffer) => {
    if (!activeRef.current) return;

    const playCtx = playContextRef.current;
    if (!playCtx) return;

    // Resume if suspended (mobile browser policy)
    if (playCtx.state === "suspended") {
      playCtx.resume().catch(() => {});
    }

    statsRef.current.received++;

    try {
      // Int16 → Float32
      const int16 = new Int16Array(data);
      const float32 = new Float32Array(int16.length);
      for (let i = 0; i < int16.length; i++) {
        float32[i] = int16[i] / 32768;
      }

      const audioBuffer = playCtx.createBuffer(1, float32.length, SAMPLE_RATE);
      audioBuffer.getChannelData(0).set(float32);

      const bufferSource = playCtx.createBufferSource();
      bufferSource.buffer = audioBuffer;
      bufferSource.connect(playCtx.destination);

      const now = playCtx.currentTime;

      // Initialize jitter buffer on first packet
      if (nextPlayTimeRef.current <= now) {
        nextPlayTimeRef.current = now + JITTER_BUFFER_MS / 1000;
      }

      // If fallen too far behind, resync
      if (nextPlayTimeRef.current < now - 1) {
        console.warn("[WsRelay] Playback fell behind — resync");
        statsRef.current.dropped++;
        nextPlayTimeRef.current = now + JITTER_BUFFER_MS / 1000;
      }

      bufferSource.start(nextPlayTimeRef.current);
      nextPlayTimeRef.current += audioBuffer.duration;
    } catch (err) {
      console.warn("[WsRelay] Playback error:", err);
    }
  }, []);

  /**
   * Get a MediaStream for the remote audio (for CallScreen UI display).
   */
  const getRemoteStream = useCallback((): MediaStream | null => {
    const playCtx = playContextRef.current;
    if (!playCtx) return null;

    try {
      const dest = playCtx.createMediaStreamDestination();
      return dest.stream;
    } catch {
      return null;
    }
  }, []);

  /**
   * Stop all audio capture and playback.
   */
  const stop = useCallback(() => {
    console.log("[WsRelay] Stopping — stats:", statsRef.current);
    stopInternal();
  }, [stopInternal]);

  /** Mute/unmute local audio */
  const setMuted = useCallback((muted: boolean) => {
    localStreamRef.current?.getAudioTracks().forEach((t) => {
      t.enabled = !muted;
    });
  }, []);

  return {
    start,
    stop,
    onBinaryMessage,
    getRemoteStream,
    setMuted,
    activeRef,
  };
}
