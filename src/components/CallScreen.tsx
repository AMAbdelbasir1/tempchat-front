/**
 * CallScreen — full-screen overlay for active/connecting calls.
 *
 * FIX: Remote video uses object-contain to show FULL video without cropping.
 * FIX: Local PiP is draggable-friendly and properly sized.
 * FIX: Responsive layout adapts to landscape (laptop) and portrait (mobile).
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import {
  Mic, MicOff, Video, VideoOff,
  PhoneOff, Phone, Loader2,
} from 'lucide-react';
import type { ActiveCall } from '../hooks/call/types';

interface Props {
  call:          ActiveCall;
  localStream:   MediaStream | null;
  remoteStream:  MediaStream | null;
  isAudioMuted:  boolean;
  isVideoMuted:  boolean;
  onToggleAudio: () => void;
  onToggleVideo: () => void;
  onHangup:      () => void;
}

function fmt(sec: number) {
  const m = Math.floor(sec / 60).toString().padStart(2, '0');
  const s = (sec % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

/** Attach a MediaStream to a <video> element safely */
function attachStream(el: HTMLVideoElement | null, stream: MediaStream | null) {
  if (!el) return;
  if (el.srcObject !== stream) {
    el.srcObject = stream;
    if (stream) {
      el.play().catch(e => console.warn('[CallScreen] play() error:', e));
    }
  }
}

export default function CallScreen({
  call,
  localStream,
  remoteStream,
  isAudioMuted,
  isVideoMuted,
  onToggleAudio,
  onToggleVideo,
  onHangup,
}: Props) {
  const localVideoRef  = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);
  const [elapsed, setElapsed] = useState(0);

  // Track if remote video has actually rendered a frame
  const [remoteVideoReady, setRemoteVideoReady] = useState(false);

  // Ref callback for local video
  const localVideoRefCb = useCallback((el: HTMLVideoElement | null) => {
    localVideoRef.current = el;
    attachStream(el, localStream);
  }, [localStream]);

  // Ref callback for remote video
  const remoteVideoRefCb = useCallback((el: HTMLVideoElement | null) => {
    remoteVideoRef.current = el;
    attachStream(el, remoteStream);

    // Listen for first frame so we know video is truly playing
    if (el && remoteStream) {
      const videoTrack = remoteStream.getVideoTracks()[0];
      if (videoTrack) {
        // loadeddata fires when first frame is available
        el.addEventListener('loadeddata', () => {
          setRemoteVideoReady(true);
        }, { once: true });
      }
    }
  }, [remoteStream]);

  // Ref callback for remote audio (voice calls)
  const remoteAudioRefCb = useCallback((el: HTMLAudioElement | null) => {
    remoteAudioRef.current = el;
    if (el && remoteStream) {
      el.srcObject = remoteStream;
      el.play().catch(e => console.warn('[CallScreen] audio play() error:', e));
    }
  }, [remoteStream]);

  // Re-attach when streams change
  useEffect(() => {
    attachStream(localVideoRef.current, localStream);
  }, [localStream]);

  useEffect(() => {
    attachStream(remoteVideoRef.current, remoteStream);
    setRemoteVideoReady(false); // reset when stream changes

    const audio = remoteAudioRef.current;
    if (audio && remoteStream && audio.srcObject !== remoteStream) {
      audio.srcObject = remoteStream;
      audio.play().catch(e => console.warn('[CallScreen] audio play() error:', e));
    }
  }, [remoteStream]);

  // Call timer
  useEffect(() => {
    if (call.state !== 'active' || !call.startedAt) return;
    setElapsed(Math.floor((Date.now() - call.startedAt) / 1000));
    const id = setInterval(() => {
      setElapsed(Math.floor((Date.now() - (call.startedAt ?? Date.now())) / 1000));
    }, 1000);
    return () => clearInterval(id);
  }, [call.state, call.startedAt]);

  const isVideo   = call.type === 'video';
  const isActive  = call.state === 'active';
  const isCalling = call.state === 'calling';

  // Check if remote stream actually has video tracks
  const remoteHasVideo = remoteStream
    ? remoteStream.getVideoTracks().length > 0 &&
      remoteStream.getVideoTracks().some(t => t.readyState === 'live')
    : false;

  return (
    <div className="fixed inset-0 z-50 bg-gray-950 flex flex-col">

      {/* Hidden audio element for voice calls — always rendered */}
      <audio ref={remoteAudioRefCb} autoPlay playsInline className="hidden" />

      {/* ── VIDEO CALL ─────────────────────────────────────────────── */}
      {isVideo ? (
        <div className="relative flex-1 bg-black overflow-hidden flex items-center justify-center">

          {/*
            ✅ FIX: Remote video uses object-contain
            - Shows the FULL video frame without cropping
            - Black bars appear on sides (letterboxing) when aspect ratios don't match
            - This is correct behavior — you see the entire person, not a cropped slice
          */}
          <video
            ref={remoteVideoRefCb}
            autoPlay
            playsInline
            className={`
              w-full h-full
              object-contain
              transition-opacity duration-500
              ${remoteStream && remoteHasVideo ? 'opacity-100' : 'opacity-0'}
            `}
          />

          {/* Waiting for remote video placeholder */}
          {(!remoteStream || !remoteHasVideo || !remoteVideoReady) && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-gray-950">
              <div className="w-24 h-24 rounded-full bg-indigo-600/20 border-2 border-indigo-500/30 flex items-center justify-center">
                <span className="text-4xl font-bold text-indigo-300">
                  {call.peer.name.charAt(0).toUpperCase()}
                </span>
              </div>
              <p className="text-white font-semibold text-lg">{call.peer.name}</p>
              <div className="flex items-center gap-2 text-slate-400 text-sm">
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>{isCalling ? 'Calling…' : 'Connecting video…'}</span>
              </div>
            </div>
          )}

          {/*
            ✅ FIX: Local video PiP
            - Uses object-cover here (small PiP — cropping is fine)
            - Aspect ratio 3:4 (portrait) to match front camera
            - Positioned with safe margins so it doesn't overlap controls
          */}
          <div className="
            absolute bottom-28 right-3
            w-24 h-32
            sm:w-32 sm:h-44
            md:w-36 md:h-48
            rounded-2xl overflow-hidden
            border-2 border-white/20
            shadow-2xl
            bg-gray-900
            z-10
          ">
            {localStream && !isVideoMuted ? (
              <video
                ref={localVideoRefCb}
                autoPlay
                playsInline
                muted
                className="w-full h-full object-cover scale-x-[-1]"
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center bg-gray-800">
                <VideoOff className="w-6 h-6 text-slate-500" />
              </div>
            )}
          </div>

          {/* Top overlay — gradient so text is readable over video */}
          <div className="
            absolute top-0 left-0 right-0
            px-4 pt-8 pb-6
            bg-gradient-to-b from-black/80 via-black/40 to-transparent
            flex items-center justify-between
            z-10
          ">
            <div>
              <p className="text-white font-semibold text-base">{call.peer.name}</p>
              <p className="text-slate-300 text-sm">
                {isActive ? fmt(elapsed) : isCalling ? 'Calling…' : 'Connecting…'}
              </p>
            </div>
            <span className="text-xs bg-indigo-600/80 text-white px-2.5 py-1 rounded-full font-medium">
              Video
            </span>
          </div>
        </div>

      ) : (
        /* ── VOICE CALL ──────────────────────────────────────────── */
        <div className="flex-1 flex flex-col items-center justify-center gap-6 bg-gradient-to-b from-gray-900 to-gray-950">

          {/* Animated avatar */}
          <div className="relative flex items-center justify-center">
            {isActive && (
              <>
                <div className="absolute w-36 h-36 rounded-full border border-indigo-500/20 animate-ping" />
                <div className="absolute w-44 h-44 rounded-full border border-indigo-500/10 animate-ping [animation-delay:300ms]" />
              </>
            )}
            <div className="w-28 h-28 rounded-full bg-indigo-600/20 border-2 border-indigo-500/40 flex items-center justify-center relative z-10">
              <span className="text-5xl font-bold text-indigo-300">
                {call.peer.name.charAt(0).toUpperCase()}
              </span>
            </div>
          </div>

          <div className="text-center">
            <p className="text-white font-bold text-2xl">{call.peer.name}</p>
            <p className="text-slate-400 text-sm mt-2 flex items-center justify-center gap-1.5">
              {!isActive && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              {isActive
                ? `🔊 ${fmt(elapsed)}`
                : isCalling
                  ? 'Calling…'
                  : call.state === 'receiving'
                    ? 'Incoming call…'
                    : 'Connecting…'}
            </p>
          </div>

          {/* Audio visualizer when active */}
          {isActive && !isAudioMuted && (
            <div className="flex items-center gap-1">
              {[1, 2, 3, 4, 3, 2, 1].map((h, i) => (
                <div
                  key={i}
                  className="w-1 bg-indigo-400 rounded-full animate-pulse"
                  style={{
                    height: `${h * 6}px`,
                    animationDelay: `${i * 80}ms`,
                  }}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── CONTROLS BAR ───────────────────────────────────────────── */}
      <div className="flex-shrink-0 bg-gray-950/95 backdrop-blur-md border-t border-white/[0.06]">
        <div className="flex items-center justify-center gap-5 px-6 py-5">

          {/* Mute mic */}
          <button
            onClick={onToggleAudio}
            title={isAudioMuted ? 'Unmute microphone' : 'Mute microphone'}
            className={`w-14 h-14 rounded-full flex items-center justify-center transition-all active:scale-95 ${
              isAudioMuted
                ? 'bg-red-500/20 border border-red-500/40 text-red-400'
                : 'bg-white/[0.08] border border-white/[0.12] text-white hover:bg-white/[0.14]'
            }`}
          >
            {isAudioMuted ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
          </button>

          {/* Hang up */}
          <button
            onClick={onHangup}
            title="End call"
            className="w-16 h-16 rounded-full bg-red-600 hover:bg-red-500 active:scale-95 flex items-center justify-center transition-all shadow-lg shadow-red-900/40"
          >
            <PhoneOff className="w-6 h-6 text-white" />
          </button>

          {/* Toggle video / spacer */}
          {isVideo ? (
            <button
              onClick={onToggleVideo}
              title={isVideoMuted ? 'Turn on camera' : 'Turn off camera'}
              className={`w-14 h-14 rounded-full flex items-center justify-center transition-all active:scale-95 ${
                isVideoMuted
                  ? 'bg-red-500/20 border border-red-500/40 text-red-400'
                  : 'bg-white/[0.08] border border-white/[0.12] text-white hover:bg-white/[0.14]'
              }`}
            >
              {isVideoMuted ? <VideoOff className="w-5 h-5" /> : <Video className="w-5 h-5" />}
            </button>
          ) : (
            <div className="w-14 h-14" /> /* keep hangup centered */
          )}
        </div>
      </div>
    </div>
  );
}

/* ── INCOMING CALL MODAL ──────────────────────────────────────────────── */
interface IncomingProps {
  call:     ActiveCall;
  onAccept: () => void;
  onReject: () => void;
}

export function IncomingCallModal({ call, onAccept, onReject }: IncomingProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-sm bg-gray-900 border border-white/[0.1] rounded-3xl p-6 shadow-2xl">

        {/* Pulse ring */}
        <div className="relative flex justify-center mb-5">
          <div className="absolute w-20 h-20 rounded-full border border-green-500/40 animate-ping" />
          <div className="w-20 h-20 rounded-full bg-indigo-600/20 border-2 border-indigo-500/40 flex items-center justify-center relative">
            <span className="text-3xl font-bold text-indigo-300">
              {call.peer.name.charAt(0).toUpperCase()}
            </span>
          </div>
        </div>

        <p className="text-center text-slate-400 text-sm mb-1">
          Incoming {call.type === 'video' ? '📹 video' : '🎙️ voice'} call
        </p>
        <p className="text-center text-white font-bold text-xl mb-6">
          {call.peer.name}
        </p>

        <div className="flex gap-4">
          <button
            onClick={onReject}
            className="flex-1 flex flex-col items-center gap-2 py-4 rounded-2xl bg-red-500/15 hover:bg-red-500/25 border border-red-500/25 transition-colors active:scale-95"
          >
            <PhoneOff className="w-6 h-6 text-red-400" />
            <span className="text-red-400 text-xs font-semibold">Decline</span>
          </button>

          <button
            onClick={onAccept}
            className="flex-1 flex flex-col items-center gap-2 py-4 rounded-2xl bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/25 transition-colors active:scale-95"
          >
            <Phone className="w-6 h-6 text-emerald-400" />
            <span className="text-emerald-400 text-xs font-semibold">Accept</span>
          </button>
        </div>
      </div>
    </div>
  );
}