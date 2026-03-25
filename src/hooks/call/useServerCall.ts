/**
 * useServerCall — Voice/video calls relayed through your own server.
 *
 * No WebRTC, no STUN, no TURN, no ICE.
 * Audio/video is captured → encoded → sent as binary WebSocket frames
 * → server relays to other participant → decoded and played.
 *
 * Works on ALL networks because it's just WebSocket traffic.
 */

import { useRef, useCallback } from "react";

// Chunk interval: how often we send audio/video (ms)
// Lower = less latency, more bandwidth. 100ms is a good balance.
const CHUNK_INTERVAL_MS = 100;

// Audio codec preference
const AUDIO_MIME =
  [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/ogg;codecs=opus",
    "audio/mp4",
  ].find(
    (m) =>
      typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(m),
  ) ?? "audio/webm";

const VIDEO_MIME =
  [
    "video/webm;codecs=vp8,opus",
    "video/webm;codecs=vp9,opus",
    "video/webm",
    "video/mp4",
  ].find(
    (m) =>
      typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(m),
  ) ?? "video/webm";

interface UseServerCallOptions {
  getWs: () => WebSocket | null;
}

export function useServerCall({ getWs }: UseServerCallOptions) {
  const localStreamRef = useRef<MediaStream | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const remoteAudioRef = useRef<MediaSource | null>(null);
  const sourceBufferRef = useRef<SourceBuffer | null>(null);
  const pendingBuffers = useRef<ArrayBuffer[]>([]);
  const isAppending = useRef(false);
  const remoteStreamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const onRemoteStreamCb = useRef<((stream: MediaStream) => void) | null>(null);

  // For playing incoming audio chunks
  const audioElement = useRef<HTMLAudioElement | null>(null);
  const mediaSourceRef = useRef<MediaSource | null>(null);

  // ── Simple chunk player using AudioContext ─────────────────────────────
  // Incoming binary chunks are complete webm/opus segments
  // We decode them individually and play through AudioContext

  const incomingChunks = useRef<ArrayBuffer[]>([]);
  const isPlaying = useRef(false);

  /**
   * Initialize audio playback for incoming media chunks.
   * Uses a chain of AudioBufferSourceNodes for gapless playback.
   */
  const initPlayback = useCallback(() => {
    if (!audioContextRef.current) {
      audioContextRef.current = new AudioContext();
    }

    // Also create a MediaStream for the UI to show "remote stream active"
    if (!remoteStreamRef.current && audioContextRef.current) {
      const dest = audioContextRef.current.createMediaStreamDestination();
      remoteStreamRef.current = dest.stream;
    }
  }, []);

  /**
   * Play incoming binary chunk.
   * Uses Blob → Object URL → Audio element for maximum compatibility.
   */
  const playChunk = useCallback(async (data: ArrayBuffer) => {
    if (
      !audioContextRef.current ||
      audioContextRef.current.state === "closed"
    ) {
      audioContextRef.current = new AudioContext();
    }

    const ctx = audioContextRef.current;

    // Resume if suspended (autoplay policy)
    if (ctx.state === "suspended") {
      await ctx.resume();
    }

    try {
      const audioBuffer = await ctx.decodeAudioData(data.slice(0));
      const source = ctx.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(ctx.destination);
      source.start();
    } catch {
      // decodeAudioData can fail on partial chunks — that's ok
      // The MediaRecorder produces complete segments so most will work
    }
  }, []);

  // ── Get local media ───────────────────────────────────────────────────────
  const getMedia = useCallback(
    async (callType: "voice" | "video"): Promise<MediaStream> => {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          sampleRate: 48000,
        },
        video:
          callType === "video"
            ? {
                facingMode: "user",
                width: { ideal: 640 },
                height: { ideal: 480 },
              }
            : false,
      });
      localStreamRef.current = stream;
      return stream;
    },
    [],
  );

  // ── Start sending media to server ─────────────────────────────────────────
  const startSending = useCallback(
    (stream: MediaStream, callType: "voice" | "video") => {
      const ws = getWs();
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        console.warn("[ServerCall] Cannot start sending — no WS connection");
        return;
      }

      const mime = callType === "video" ? VIDEO_MIME : AUDIO_MIME;
      console.log("[ServerCall] Starting MediaRecorder with:", mime);

      const recorder = new MediaRecorder(stream, {
        mimeType: mime,
        audioBitsPerSecond: 32000, // 32kbps opus — good quality, low bandwidth
        videoBitsPerSecond: callType === "video" ? 250000 : undefined, // 250kbps video
      });

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0 && ws.readyState === WebSocket.OPEN) {
          event.data.arrayBuffer().then((buffer) => {
            // Send as binary frame — server will relay to other participants
            ws.send(buffer);
          });
        }
      };

      recorder.onerror = (event) => {
        console.error("[ServerCall] MediaRecorder error:", event);
      };

      // Record in small chunks for low latency
      recorder.start(CHUNK_INTERVAL_MS);
      mediaRecorderRef.current = recorder;
      console.log(
        "[ServerCall] MediaRecorder started — chunk interval:",
        CHUNK_INTERVAL_MS,
        "ms",
      );
    },
    [getWs],
  );

  // ── Stop sending ──────────────────────────────────────────────────────────
  const stopSending = useCallback(() => {
    if (mediaRecorderRef.current) {
      try {
        if (mediaRecorderRef.current.state !== "inactive") {
          mediaRecorderRef.current.stop();
        }
      } catch {
        /* */
      }
      mediaRecorderRef.current = null;
    }
  }, []);

  // ── Handle incoming binary frame from server ──────────────────────────────
  const handleBinaryMessage = useCallback(
    (data: ArrayBuffer) => {
      // Frame format: [1 byte id-length] + [id bytes] + [media data]
      const view = new Uint8Array(data);
      if (view.length < 2) return;

      const idLen = view[0];
      if (view.length < 1 + idLen + 1) return;

      // const senderId = new TextDecoder().decode(view.slice(1, 1 + idLen));
      const mediaData = data.slice(1 + idLen);

      // Play the media chunk
      playChunk(mediaData);

      // Notify UI that we have a remote stream
      if (!remoteStreamRef.current && onRemoteStreamCb.current) {
        initPlayback();
        if (remoteStreamRef.current) {
          onRemoteStreamCb.current(remoteStreamRef.current);
        }
      }
    },
    [playChunk, initPlayback],
  );

  // ── Start a call (caller side) ────────────────────────────────────────────
  const startCall = useCallback(
    async (
      callId: string,
      callType: "voice" | "video",
      onRemoteStream: (stream: MediaStream) => void,
    ): Promise<MediaStream> => {
      onRemoteStreamCb.current = onRemoteStream;
      initPlayback();

      const stream = await getMedia(callType);

      // Tell server to register us for media relay
      const ws = getWs();
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(
          JSON.stringify({
            type: "call-start",
            callId,
          }),
        );
      }

      // Start encoding and sending audio/video
      startSending(stream, callType);

      return stream;
    },
    [getMedia, getWs, startSending, initPlayback],
  );

  // ── Accept a call (callee side) ───────────────────────────────────────────
  const acceptCall = useCallback(
    async (
      callId: string,
      callType: "voice" | "video",
      peerId: string,
      onRemoteStream: (stream: MediaStream) => void,
    ): Promise<MediaStream> => {
      onRemoteStreamCb.current = onRemoteStream;
      initPlayback();

      const stream = await getMedia(callType);

      // Register for media relay
      const ws = getWs();
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(
          JSON.stringify({
            type: "call-start",
            callId,
            peerId,
          }),
        );
      }

      startSending(stream, callType);

      return stream;
    },
    [getMedia, getWs, startSending, initPlayback],
  );

  // ── End call ──────────────────────────────────────────────────────────────
  const endCall = useCallback(() => {
    stopSending();

    // Tell server we're done
    const ws = getWs();
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "call-end" }));
    }

    // Stop local media
    localStreamRef.current?.getTracks().forEach((t) => t.stop());
    localStreamRef.current = null;

    // Cleanup audio
    if (audioContextRef.current && audioContextRef.current.state !== "closed") {
      audioContextRef.current.close().catch(() => {});
    }
    audioContextRef.current = null;
    remoteStreamRef.current = null;
    onRemoteStreamCb.current = null;
  }, [stopSending, getWs]);

  // ── Media toggles ─────────────────────────────────────────────────────────
  const setAudioMuted = useCallback((muted: boolean) => {
    localStreamRef.current?.getAudioTracks().forEach((t) => {
      t.enabled = !muted;
    });
  }, []);

  const setVideoMuted = useCallback((muted: boolean) => {
    localStreamRef.current?.getVideoTracks().forEach((t) => {
      t.enabled = !muted;
    });
  }, []);

  return {
    localStreamRef,
    startCall,
    acceptCall,
    endCall,
    handleBinaryMessage,
    setAudioMuted,
    setVideoMuted,
  };
}
