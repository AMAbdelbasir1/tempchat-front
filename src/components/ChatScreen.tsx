import { useEffect, useRef, useState, useCallback } from 'react';
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
  onSendMessage: (text: string) => void;
  onSendFile: (file: File) => void;
  onSendLink: (url: string) => void;
  onDisconnect: () => void;
  // ✅ NEW: message actions
  onEditMessage: (id: string, newContent: string) => void;
  onDeleteMessage: (id: string, isMine: boolean) => void;
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
  onEditMessage, onDeleteMessage,
  activeCall, localStream, remoteStream,
  isAudioMuted, isVideoMuted, callError,
  onStartVoiceCall, onStartVideoCall,
  onAcceptCall, onRejectCall, onHangup,
  onToggleAudio, onToggleVideo,
}: Props) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const [editingMsg, setEditingMsg] = useState<Message | null>(null);
  const [copiedToast, setCopiedToast] = useState(false);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    const setVH = () => {
      const vh = window.innerHeight * 0.01;
      document.documentElement.style.setProperty('--vh', `${vh}px`);
    };
    setVH();
    window.addEventListener('resize', setVH);
    window.addEventListener('orientationchange', () => setTimeout(setVH, 100));
    if (window.visualViewport) window.visualViewport.addEventListener('resize', setVH);
    return () => {
      window.removeEventListener('resize', setVH);
      if (window.visualViewport) window.visualViewport.removeEventListener('resize', setVH);
    };
  }, []);

  const isDisabled = status !== 'connected';
  const noPeers   = peerCount === 0 && status === 'connected';

  const shareRoom = async () => {
    if (navigator.share) {
      try { await navigator.share({ title: 'Join my TempLink room', text: `Join room ${room.code} on TempLink`, url: room.link }); }
      catch { /* cancelled */ }
    } else {
      navigator.clipboard.writeText(room.link);
    }
  };

  // ── Message action handlers ──────────────────────────────
  const handleCopy = useCallback((_msg: Message) => {
    setCopiedToast(true);
    setTimeout(() => setCopiedToast(false), 1500);
  }, []);

  const handleEdit = useCallback((msg: Message) => {
    setEditingMsg(msg);
  }, []);

  const handleDelete = useCallback((msg: Message) => {
    onDeleteMessage(msg.id, msg.sender === 'me');
  }, [onDeleteMessage]);

  const handleEditMessage = useCallback((id: string, newContent: string) => {
    onEditMessage(id, newContent);
    setEditingMsg(null);
  }, [onEditMessage]);

  const handleCancelEdit = useCallback(() => {
    setEditingMsg(null);
  }, []);

  return (
    <div className="fixed inset-0 flex flex-col bg-gray-950"
      style={{ height: 'calc(var(--vh, 1vh) * 100)' }}>

      <RoomHeader
        room={room} peerCount={peerCount} peers={peers} status={status}
        fingerprint={fingerprint} isOnline={isOnline} mode={mode}
        onDisconnect={onDisconnect}
        onStartVoiceCall={onStartVoiceCall} onStartVideoCall={onStartVideoCall}
      />

      {callError && (
        <div className="flex-shrink-0 flex items-center justify-center gap-2 bg-red-500/10 border-b border-red-500/20 px-4 py-2">
          <span className="text-red-400 text-xs font-medium">⚠️ {callError}</span>
        </div>
      )}

      {/* ── Copied toast ── */}
      {copiedToast && (
        <div className="absolute top-16 left-1/2 -translate-x-1/2 z-50 bg-emerald-500/20 border border-emerald-500/30 text-emerald-300 text-xs px-3 py-1.5 rounded-full backdrop-blur-sm animate-in fade-in duration-200">
          ✅ Copied to clipboard
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-4 py-4">
        <div className="max-w-3xl mx-auto space-y-1">
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
                  <button onClick={shareRoom}
                    className="flex-1 flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold px-4 py-2.5 rounded-xl transition-colors">
                    <Share2 className="w-4 h-4" /><span>Share Link</span>
                  </button>
                  <button onClick={() => {
                    const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(room.link)}`;
                    window.open(qrUrl, '_blank');
                  }}
                    className="flex-1 flex items-center justify-center gap-2 bg-white/[0.06] hover:bg-white/[0.1] border border-white/[0.08] text-slate-300 text-sm font-semibold px-4 py-2.5 rounded-xl transition-colors">
                    <QrCode className="w-4 h-4" /><span>QR Code</span>
                  </button>
                </div>
              </div>
              <p className="text-slate-600 text-xs mt-4 break-all max-w-xs">{room.link}</p>
            </div>
          )}

          {messages.map(msg => (
            <MessageBubble
              key={msg.id}
              msg={msg}
              onCopy={handleCopy}
              onEdit={handleEdit}
              onDelete={handleDelete}
            />
          ))}
          <div ref={bottomRef} />
        </div>
      </div>

      <ChatInput
        onSendMessage={onSendMessage} onSendFile={onSendFile} onSendLink={onSendLink}
        disabled={isDisabled}
        editingMsg={editingMsg}
        onEditMessage={handleEditMessage}
        onCancelEdit={handleCancelEdit}
      />

      {activeCall && activeCall.state !== 'receiving' && (
        <CallScreen call={activeCall} localStream={localStream} remoteStream={remoteStream}
          isAudioMuted={isAudioMuted} isVideoMuted={isVideoMuted}
          onToggleAudio={onToggleAudio} onToggleVideo={onToggleVideo} onHangup={onHangup} />
      )}
      {activeCall && activeCall.state === 'receiving' && (
        <IncomingCallModal call={activeCall} onAccept={onAcceptCall} onReject={onRejectCall} />
      )}
    </div>
  );
}