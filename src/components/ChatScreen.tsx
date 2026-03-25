import { useEffect, useRef } from 'react';
import { Users, Share2, QrCode } from 'lucide-react';
import { Message, Room, ConnectionStatus } from '../types';
import type { ActiveCall } from '../hooks/call/types';
import MessageBubble from './MessageBubble';
import RoomHeader from './RoomHeader';
import ChatInput from './ChatInput';
import CallScreen, { IncomingCallModal } from './CallScreen';

interface Props {
  room: Room;
  messages: Message[];
  peerCount: number;
  peers: { id: string; name: string }[];
  status: ConnectionStatus;
  fingerprint?: string;
  isOnline?: boolean;
  mode?: 'server' | 'mqtt';
  // chat
  onSendMessage: (text: string) => void;
  onSendFile: (file: File) => void;
  onSendLink: (url: string) => void;
  onDisconnect: () => void;
  // call
  activeCall:    ActiveCall | null;
  localStream:   MediaStream | null;
  remoteStream:  MediaStream | null;
  isAudioMuted:  boolean;
  isVideoMuted:  boolean;
  callError:     string | null;
  onStartVoiceCall: (peerId: string, peerName: string) => void;
  onStartVideoCall: (peerId: string, peerName: string) => void;
  onAcceptCall:  () => void;
  onRejectCall:  () => void;
  onHangup:      () => void;
  onToggleAudio: () => void;
  onToggleVideo: () => void;
}

export default function ChatScreen({
  room, messages, peerCount, peers, status, fingerprint,
  isOnline = true, mode,
  onSendMessage, onSendFile, onSendLink, onDisconnect,
  activeCall, localStream, remoteStream,
  isAudioMuted, isVideoMuted, callError,
  onStartVoiceCall, onStartVideoCall,
  onAcceptCall, onRejectCall, onHangup,
  onToggleAudio, onToggleVideo,
}: Props) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  /*
   * ✅ FIX: Mobile viewport height
   *
   * On mobile browsers, 100vh includes the address bar, pushing content
   * off-screen. We use a CSS custom property --vh set from JS to get
   * the ACTUAL visible viewport height.
   *
   * This runs on mount and on resize/orientation change.
   */
  useEffect(() => {
    const setVH = () => {
      const vh = window.innerHeight * 0.01;
      document.documentElement.style.setProperty('--vh', `${vh}px`);
    };

    setVH();
    window.addEventListener('resize', setVH);
    window.addEventListener('orientationchange', () => {
      // Delay slightly — some browsers don't update innerHeight immediately
      setTimeout(setVH, 100);
    });

    // Also handle virtual keyboard on mobile
    if ('visualViewport' in window && window.visualViewport) {
      window.visualViewport.addEventListener('resize', setVH);
    }

    return () => {
      window.removeEventListener('resize', setVH);
      if ('visualViewport' in window && window.visualViewport) {
        window.visualViewport.removeEventListener('resize', setVH);
      }
    };
  }, []);

  const isDisabled = status !== 'connected';
  const noPeers   = peerCount === 0 && status === 'connected';

  const shareRoom = async () => {
    if (navigator.share) {
      try {
        await navigator.share({
          title: 'Join my TempLink room',
          text:  `Join room ${room.code} on TempLink`,
          url:   room.link,
        });
      } catch { /* cancelled */ }
    } else {
      navigator.clipboard.writeText(room.link);
    }
  };

  return (
    /*
     * ✅ FIX: Use `fixed inset-0` instead of `h-screen`
     *
     * `h-screen` = 100vh = BROKEN on mobile (includes address bar)
     * `fixed inset-0` = always exactly the visible viewport
     *
     * The flex layout ensures:
     *   - RoomHeader: pinned at top (flex-shrink-0)
     *   - Messages:   scrollable middle (flex-1 overflow-y-auto min-h-0)
     *   - ChatInput:  pinned at bottom (flex-shrink-0)
     */
    <div
      className="fixed inset-0 flex flex-col bg-gray-950"
      style={{
        /* Fallback: use --vh if available, otherwise inset-0 handles it */
        height: 'calc(var(--vh, 1vh) * 100)',
      }}
    >

      {/* ── HEADER — always visible at top ── */}
      <RoomHeader
        room={room}
        peerCount={peerCount}
        peers={peers}
        status={status}
        fingerprint={fingerprint}
        isOnline={isOnline}
        mode={mode}
        onDisconnect={onDisconnect}
        onStartVoiceCall={onStartVoiceCall}
        onStartVideoCall={onStartVideoCall}
      />

      {/* Call error toast */}
      {callError && (
        <div className="flex-shrink-0 flex items-center justify-center gap-2 bg-red-500/10 border-b border-red-500/20 px-4 py-2">
          <span className="text-red-400 text-xs font-medium">⚠️ {callError}</span>
        </div>
      )}

      {/*
       * ✅ FIX: Messages area — scrollable middle section
       *
       * Key CSS:
       *   flex-1     → takes all remaining space between header and input
       *   min-h-0    → CRITICAL: allows flex child to shrink below content size
       *                without this, the flex item overflows and pushes input off-screen
       *   overflow-y-auto → only this div scrolls, not the whole page
       */}
      <div
        ref={scrollContainerRef}
        className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-4 py-4"
      >
        <div className="max-w-3xl mx-auto space-y-1">

          {/* Waiting for peers banner */}
          {noPeers && (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <div className="relative mb-6">
                <div className="w-20 h-20 rounded-full border-2 border-indigo-500/20 absolute inset-0 animate-ping" />
                <div className="w-20 h-20 rounded-full border border-indigo-500/30 flex items-center justify-center relative z-10 bg-indigo-500/5">
                  <Users className="w-8 h-8 text-indigo-400" />
                </div>
              </div>
              <h3 className="text-white font-bold text-lg mb-1">Waiting for others to join</h3>
              <p className="text-slate-500 text-sm mb-6 max-w-xs">
                Share the link or code below with whoever you want to connect with
              </p>
              <div className="flex flex-col sm:flex-row gap-3 w-full max-w-sm">
                <div className="flex-1 bg-white/[0.04] border border-white/[0.08] rounded-xl px-4 py-3 text-center">
                  <p className="text-slate-500 text-xs mb-1">Room Code</p>
                  <p className="text-white font-mono font-black text-2xl tracking-[0.3em]">{room.code}</p>
                </div>
                <div className="flex sm:flex-col gap-2">
                  <button
                    onClick={shareRoom}
                    className="flex-1 flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold px-4 py-2.5 rounded-xl transition-colors"
                  >
                    <Share2 className="w-4 h-4" />
                    <span>Share Link</span>
                  </button>
                  <button
                    onClick={() => {
                      const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(room.link)}`;
                      window.open(qrUrl, '_blank');
                    }}
                    className="flex-1 flex items-center justify-center gap-2 bg-white/[0.06] hover:bg-white/[0.1] border border-white/[0.08] text-slate-300 text-sm font-semibold px-4 py-2.5 rounded-xl transition-colors"
                  >
                    <QrCode className="w-4 h-4" />
                    <span>QR Code</span>
                  </button>
                </div>
              </div>
              <p className="text-slate-600 text-xs mt-4 break-all max-w-xs">
                {room.link}
              </p>
            </div>
          )}

          {/* Messages */}
          {messages.map(msg => (
            <MessageBubble key={msg.id} msg={msg} />
          ))}
          <div ref={bottomRef} />
        </div>
      </div>

      {/* ── INPUT — always visible at bottom ── */}
      <ChatInput
        onSendMessage={onSendMessage}
        onSendFile={onSendFile}
        onSendLink={onSendLink}
        disabled={isDisabled}
      />

      {/* ── Active / connecting call overlay ── */}
      {activeCall && activeCall.state !== 'receiving' && (
        <CallScreen
          call={activeCall}
          localStream={localStream}
          remoteStream={remoteStream}
          isAudioMuted={isAudioMuted}
          isVideoMuted={isVideoMuted}
          onToggleAudio={onToggleAudio}
          onToggleVideo={onToggleVideo}
          onHangup={onHangup}
        />
      )}

      {/* ── Incoming call modal ── */}
      {activeCall && activeCall.state === 'receiving' && (
        <IncomingCallModal
          call={activeCall}
          onAccept={onAcceptCall}
          onReject={onRejectCall}
        />
      )}
    </div>
  );
}