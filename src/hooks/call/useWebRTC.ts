/**
 * useWebRTC — WebRTC engine for voice/video calls.
 *
 * FIX: Added TURN servers for mobile carrier NAT traversal.
 * FIX: Increased ICE timeout to 25s to allow TURN relay candidates.
 * FIX: Exposes hasConnectedRef so useCall can trigger WS relay fallback.
 */

import { useRef, useCallback } from "react";
import type { SignalPayload } from "./types";

/*
 * ICE servers — STUN for reflexive candidates + TURN for relay candidates.
 *
 * TURN is CRITICAL for mobile carriers (symmetric NAT).
 * Without TURN, mobile-to-mobile calls will almost always fail.
 *
 * The free openrelay servers below work for development/testing.
 * For production, run your own coturn server alongside your WS relay.
 */
const ICE_SERVERS: RTCIceServer[] = [
  // ── STUN ──
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
  { urls: "stun:stun2.l.google.com:19302" },
  { urls: "stun:stun.cloudflare.com:3478" },

  // ── TURN (free open relay — essential for mobile) ──
  {
    urls: [
      "turn:openrelay.metered.ca:80",
      "turn:openrelay.metered.ca:443",
      "turns:openrelay.metered.ca:443",
    ],
    username: "openrelayproject",
    credential: "openrelayproject",
  },
  // Additional free TURN for redundancy
  {
    urls: "turn:relay.metered.ca:80",
    username: "e8dd65b92c91cfe46e4de44e",
    credential: "1ZDBOhOHc/yBVMHo",
  },
];

const DISCONNECTED_GRACE_MS = 8_000;
// 25s — TURN relay candidates take longer than STUN; give them time
const ICE_TIMEOUT_MS = 25_000;

interface UseWebRTCOptions {
  onSignal: (payload: SignalPayload) => void;
  onRemoteStream: (stream: MediaStream) => void;
  onEnded: () => void;
}

export function useWebRTC({
  onSignal,
  onRemoteStream,
  onEnded,
}: UseWebRTCOptions) {
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const pendingIce = useRef<RTCIceCandidateInit[]>([]);
  const remoteDescSet = useRef(false);
  const activeCallId = useRef<string | null>(null);
  const hasConnectedRef = useRef(false);
  const endedFired = useRef(false);

  const disconnectedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const iceTimeoutTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const callMetaRef = useRef<{
    callId: string;
    myId: string;
    myName: string;
    callType: "voice" | "video";
  } | null>(null);

  const clearTimers = useCallback(() => {
    if (disconnectedTimer.current) {
      clearTimeout(disconnectedTimer.current);
      disconnectedTimer.current = null;
    }
    if (iceTimeoutTimer.current) {
      clearTimeout(iceTimeoutTimer.current);
      iceTimeoutTimer.current = null;
    }
  }, []);

  const fireEnded = useCallback(() => {
    if (endedFired.current) return;
    endedFired.current = true;
    onEnded();
  }, [onEnded]);

  const destroy = useCallback(() => {
    clearTimers();
    localStreamRef.current?.getTracks().forEach((t) => t.stop());
    localStreamRef.current = null;
    if (pcRef.current) {
      pcRef.current.onicecandidate = null;
      pcRef.current.ontrack = null;
      pcRef.current.onconnectionstatechange = null;
      pcRef.current.oniceconnectionstatechange = null;
      pcRef.current.onicegatheringstatechange = null;
      try {
        pcRef.current.close();
      } catch {
        /* */
      }
    }
    pcRef.current = null;
    pendingIce.current = [];
    remoteDescSet.current = false;
    callMetaRef.current = null;
    activeCallId.current = null;
    hasConnectedRef.current = false;
    endedFired.current = false;
  }, [clearTimers]);

  const getMedia = useCallback(
    async (callType: "voice" | "video"): Promise<MediaStream> => {
      const constraints: MediaStreamConstraints = {
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video:
          callType === "video"
            ? {
                facingMode: "user",
                width: { ideal: 640 },
                height: { ideal: 480 },
              }
            : false,
      };
      try {
        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        localStreamRef.current = stream;
        return stream;
      } catch (err) {
        if (callType === "video") {
          console.warn("[WebRTC] Video failed, trying audio-only:", err);
          const audioOnly = await navigator.mediaDevices.getUserMedia({
            audio: constraints.audio,
            video: false,
          });
          localStreamRef.current = audioOnly;
          return audioOnly;
        }
        throw err;
      }
    },
    [],
  );

  const createPC = useCallback(
    (
      callId: string,
      myId: string,
      myName: string,
      callType: "voice" | "video",
    ): RTCPeerConnection => {
      // Clean up any existing PC
      if (pcRef.current) {
        pcRef.current.onicecandidate = null;
        pcRef.current.ontrack = null;
        pcRef.current.onconnectionstatechange = null;
        pcRef.current.oniceconnectionstatechange = null;
        pcRef.current.onicegatheringstatechange = null;
        try {
          pcRef.current.close();
        } catch {
          /* */
        }
        pcRef.current = null;
      }

      clearTimers();
      remoteDescSet.current = false;
      hasConnectedRef.current = false;
      endedFired.current = false;
      callMetaRef.current = { callId, myId, myName, callType };
      activeCallId.current = callId;

      const pc = new RTCPeerConnection({
        iceServers: ICE_SERVERS,
        iceCandidatePoolSize: 10,
        iceTransportPolicy: "all",
        bundlePolicy: "max-bundle",
        rtcpMuxPolicy: "require",
      });

      // ── ICE candidates ──
      pc.onicecandidate = ({ candidate }) => {
        if (!candidate) {
          console.log("[WebRTC] ICE gathering complete");
          return;
        }
        const meta = callMetaRef.current;
        if (!meta) return;

        // Log candidate type — especially useful to verify TURN relay works
        const tag =
          candidate.type === "relay"
            ? "🔄 RELAY"
            : candidate.type === "srflx"
              ? "📡 SRFLX"
              : candidate.type === "host"
                ? "🏠 HOST"
                : candidate.type;
        console.log(
          `[WebRTC] ICE candidate: ${tag} ${candidate.protocol} ${candidate.address}`,
        );

        onSignal({
          action: "call-ice",
          callId: meta.callId,
          fromId: meta.myId,
          fromName: meta.myName,
          callType: meta.callType,
          ice: candidate.toJSON(),
        });
      };

      pc.onicegatheringstatechange = () => {
        console.log("[WebRTC] ICE gathering:", pc.iceGatheringState);
      };

      pc.oniceconnectionstatechange = () => {
        const state = pc.iceConnectionState;
        console.log("[WebRTC] ICE connection:", state);

        if (state === "connected" || state === "completed") {
          clearTimers();
          hasConnectedRef.current = true;
          console.log("[WebRTC] ✅ ICE connected!");
        }

        if (state === "failed") {
          if (!hasConnectedRef.current) {
            console.error("[WebRTC] ICE never connected — ending");
            fireEnded();
          } else {
            console.warn(
              "[WebRTC] ICE failed after previous connection — restarting",
            );
            try {
              pc.restartIce();
            } catch {
              /* */
            }
          }
        }
      };

      // ── Remote tracks ──
      pc.ontrack = (evt) => {
        console.log(
          "[WebRTC] 🎵 Remote track:",
          evt.track.kind,
          "| readyState:",
          evt.track.readyState,
          "| muted:",
          evt.track.muted,
        );
        const stream = evt.streams?.[0] || new MediaStream([evt.track]);
        onRemoteStream(stream);

        evt.track.onunmute = () => {
          console.log("[WebRTC] Track unmuted:", evt.track.kind);
          onRemoteStream(stream);
        };
      };

      // ── Connection state ──
      pc.onconnectionstatechange = () => {
        const state = pc.connectionState;
        console.log("[WebRTC] Connection state:", state);

        if (disconnectedTimer.current) {
          clearTimeout(disconnectedTimer.current);
          disconnectedTimer.current = null;
        }

        switch (state) {
          case "connected":
            clearTimers();
            hasConnectedRef.current = true;
            break;

          case "disconnected":
            console.warn(
              "[WebRTC] Disconnected — grace period",
              DISCONNECTED_GRACE_MS,
              "ms",
            );
            disconnectedTimer.current = setTimeout(() => {
              const p = pcRef.current;
              if (
                p &&
                p.connectionState !== "connected" &&
                p.iceConnectionState !== "connected" &&
                p.iceConnectionState !== "completed"
              ) {
                fireEnded();
              }
            }, DISCONNECTED_GRACE_MS);
            break;

          case "failed":
            if (hasConnectedRef.current) {
              try {
                pc.restartIce();
              } catch {
                /* */
              }
              disconnectedTimer.current = setTimeout(() => {
                if (pcRef.current?.connectionState === "failed") fireEnded();
              }, 10_000);
            } else {
              fireEnded();
            }
            break;

          case "closed":
            fireEnded();
            break;
        }
      };

      pcRef.current = pc;

      // ── ICE timeout — fail so WS relay can take over ──
      iceTimeoutTimer.current = setTimeout(() => {
        const p = pcRef.current;
        if (
          p &&
          p.connectionState !== "connected" &&
          p.iceConnectionState !== "connected" &&
          p.iceConnectionState !== "completed"
        ) {
          console.error(
            "[WebRTC] ICE timeout —",
            ICE_TIMEOUT_MS / 1000,
            "s — no P2P connection",
          );
          fireEnded();
        }
      }, ICE_TIMEOUT_MS);

      return pc;
    },
    [onSignal, onRemoteStream, fireEnded, clearTimers],
  );

  const drainPendingIce = useCallback(async (pc: RTCPeerConnection) => {
    const candidates = [...pendingIce.current];
    pendingIce.current = [];
    console.log(
      `[WebRTC] Draining ${candidates.length} buffered ICE candidates`,
    );
    for (const ice of candidates) {
      try {
        await pc.addIceCandidate(new RTCIceCandidate(ice));
      } catch (e) {
        console.warn("[WebRTC] ICE drain error:", e);
      }
    }
  }, []);

  // ── Start call (caller) ──
  const startCall = useCallback(
    async (
      callId: string,
      myId: string,
      myName: string,
      callType: "voice" | "video",
    ): Promise<MediaStream> => {
      pendingIce.current = [];
      const localStream = await getMedia(callType);
      const pc = createPC(callId, myId, myName, callType);

      localStream.getTracks().forEach((track) => {
        console.log("[WebRTC] Adding local track:", track.kind, track.enabled);
        pc.addTrack(track, localStream);
      });

      const offer = await pc.createOffer({
        offerToReceiveAudio: true,
        offerToReceiveVideo: callType === "video",
      });
      await pc.setLocalDescription(offer);

      console.log("[WebRTC] Offer created — sending ring+offer");
      onSignal({
        action: "call-ring",
        callId,
        fromId: myId,
        fromName: myName,
        callType,
        sdp: pc.localDescription!,
      });

      return localStream;
    },
    [getMedia, createPC, onSignal],
  );

  // ── Accept call (callee) ──
  const acceptCall = useCallback(
    async (
      signal: SignalPayload,
      myId: string,
      myName: string,
    ): Promise<MediaStream> => {
      if (!signal.sdp) throw new Error("No SDP in signal");

      console.log(
        "[WebRTC] Accepting call — buffered ICE:",
        pendingIce.current.length,
      );

      const localStream = await getMedia(signal.callType);
      const pc = createPC(signal.callId, myId, myName, signal.callType);

      localStream.getTracks().forEach((track) => {
        console.log("[WebRTC] Adding local track:", track.kind, track.enabled);
        pc.addTrack(track, localStream);
      });

      await pc.setRemoteDescription(new RTCSessionDescription(signal.sdp));
      remoteDescSet.current = true;
      console.log("[WebRTC] Remote offer set (callee)");

      await drainPendingIce(pc);

      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);

      console.log("[WebRTC] Answer created — sending");
      onSignal({
        action: "call-answer",
        callId: signal.callId,
        fromId: myId,
        fromName: myName,
        callType: signal.callType,
        sdp: pc.localDescription!,
      });

      return localStream;
    },
    [getMedia, createPC, onSignal, drainPendingIce],
  );

  // ── Handle answer (caller receives callee's answer) ──
  const handleAnswer = useCallback(
    async (signal: SignalPayload) => {
      const pc = pcRef.current;
      if (!pc || !signal.sdp) return;
      if (pc.signalingState === "closed") return;
      if (pc.signalingState !== "have-local-offer") {
        if (pc.signalingState === "stable") return;
      }
      try {
        await pc.setRemoteDescription(new RTCSessionDescription(signal.sdp));
        remoteDescSet.current = true;
        console.log("[WebRTC] Remote answer set (caller)");
        await drainPendingIce(pc);
      } catch (err) {
        console.error("[WebRTC] handleAnswer error:", err);
      }
    },
    [drainPendingIce],
  );

  // ── Handle ICE candidate ──
  const handleIce = useCallback(async (signal: SignalPayload) => {
    if (!signal.ice) return;
    if (activeCallId.current && signal.callId !== activeCallId.current) return;

    const pc = pcRef.current;
    if (pc && remoteDescSet.current) {
      if (pc.signalingState === "closed") return;
      try {
        await pc.addIceCandidate(new RTCIceCandidate(signal.ice));
      } catch (e) {
        console.warn("[WebRTC] ICE add error:", e);
      }
    } else {
      pendingIce.current.push(signal.ice);
      console.log("[WebRTC] Buffering ICE — total:", pendingIce.current.length);
    }
  }, []);

  // ── Mute controls ──
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
    hasConnectedRef,
    startCall,
    acceptCall,
    handleAnswer,
    handleIce,
    setAudioMuted,
    setVideoMuted,
    destroy,
  };
}
