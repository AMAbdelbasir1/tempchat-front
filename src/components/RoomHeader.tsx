import { useState, useRef, useEffect } from 'react';
import { Check, LogOut, Users, ShieldCheck, Phone, Video, Link2, Loader2 } from 'lucide-react';
import { Room, ConnectionStatus } from '../types';

interface Props {
  room: Room;
  peerCount: number;
  status: ConnectionStatus;
  fingerprint?: string;
  isOnline?: boolean;
  mode?: 'server' | 'mqtt';
  peers: { id: string; name: string }[];
  onDisconnect: () => void;
  onStartVoiceCall: (peerId: string, peerName: string) => void;
  onStartVideoCall: (peerId: string, peerName: string) => void;
}

export default function RoomHeader({
  room, peerCount, status, fingerprint, isOnline = true, mode,
  peers, onDisconnect, onStartVoiceCall, onStartVideoCall,
}: Props) {
  const [copiedLink,  setCopiedLink]  = useState(false);
  const [showFpInfo,  setShowFpInfo]  = useState(false);
  const [callOpen,    setCallOpen]    = useState(false);
  const callRef = useRef<HTMLDivElement>(null);

  // Close call menu when clicking outside
  useEffect(() => {
    if (!callOpen) return;
    const handler = (e: MouseEvent) => {
      if (callRef.current && !callRef.current.contains(e.target as Node)) {
        setCallOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [callOpen]);

  const copyLink = () => {
    navigator.clipboard.writeText(room.link);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2000);
  };

  const peer = peers[0];

  return (
    <div className="flex-shrink-0 bg-gray-950/95 backdrop-blur-md border-b border-white/[0.06] z-20">

      {/* ── Main bar ── */}
      <div className="px-3 py-2.5">
        <div className="flex items-center gap-2">

          {/* Room code pill */}
          <div className="flex items-center gap-1.5 bg-white/[0.05] border border-white/[0.08] rounded-lg px-2.5 py-1.5 min-w-0">
            <span className="text-xs font-mono font-bold text-indigo-300 tracking-[0.18em] truncate">
              {room.code}
            </span>
            {/* dot indicator */}
            <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
              !isOnline        ? 'bg-yellow-400 animate-pulse' :
              status === 'connected' ? 'bg-emerald-400' :
              status === 'connecting' ? 'bg-yellow-400 animate-pulse' :
              'bg-red-400'
            }`} />
          </div>

          {/* Peer count */}
          <div className="flex items-center gap-1 px-2 py-1.5 rounded-lg bg-white/[0.04] border border-white/[0.06]">
            <Users className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
            <span className="text-xs text-slate-400 font-medium">{peerCount + 1}</span>
          </div>

          {/* Mode indicator */}
          {mode && (
            <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${
              mode === 'server'
                ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                : 'bg-indigo-500/10 text-indigo-400 border border-indigo-500/20'
            }`}>
              {mode === 'server' ? '🖥️' : '📡'}
            </span>
          )}

          {/* Spacer */}
          <div className="flex-1" />

          {/* Copy link */}
          <button
            onClick={copyLink}
            title="Copy invite link"
            className="w-9 h-9 rounded-xl bg-white/[0.05] hover:bg-white/[0.1] border border-white/[0.08] flex items-center justify-center text-slate-400 hover:text-slate-200 transition-colors flex-shrink-0"
          >
            {copiedLink
              ? <Check className="w-4 h-4 text-emerald-400" />
              : <Link2 className="w-4 h-4" />
            }
          </button>

          {/* Call button (expandable) */}
          {peerCount > 0 && peer && (
            <div className="relative flex-shrink-0" ref={callRef}>
              {/* Main call icon */}
              <button
                onClick={() => setCallOpen(v => !v)}
                className={`w-9 h-9 rounded-xl border flex items-center justify-center transition-all active:scale-95 flex-shrink-0 ${
                  callOpen
                    ? 'bg-indigo-600 border-indigo-500 text-white'
                    : 'bg-white/[0.05] hover:bg-white/[0.1] border-white/[0.08] text-slate-400 hover:text-slate-200'
                }`}
                title="Start a call"
              >
                <Phone className="w-4 h-4" />
              </button>

              {/* Sub-buttons — drop DOWN below the button */}
              {callOpen && (
                <div className="absolute top-full right-0 mt-2 flex flex-col items-stretch gap-1.5 z-50 min-w-[130px]">
                  {/* Voice */}
                  <button
                    onClick={() => { onStartVoiceCall(peer.id, peer.name); setCallOpen(false); }}
                    className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 text-white text-xs font-semibold px-3 py-2.5 rounded-xl shadow-xl shadow-black/40 transition-all active:scale-95 whitespace-nowrap"
                  >
                    <Phone className="w-3.5 h-3.5 flex-shrink-0" />
                    Voice call
                  </button>
                  {/* Video */}
                  <button
                    onClick={() => { onStartVideoCall(peer.id, peer.name); setCallOpen(false); }}
                    className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 active:bg-indigo-700 text-white text-xs font-semibold px-3 py-2.5 rounded-xl shadow-xl shadow-black/40 transition-all active:scale-95 whitespace-nowrap"
                  >
                    <Video className="w-3.5 h-3.5 flex-shrink-0" />
                    Video call
                  </button>
                </div>
              )}
            </div>
          )}

          {/* E2E shield */}
          <button
            onClick={() => setShowFpInfo(v => !v)}
            title="End-to-end encrypted"
            className={`w-9 h-9 rounded-xl border flex items-center justify-center transition-colors flex-shrink-0 ${
              showFpInfo
                ? 'bg-emerald-600/20 border-emerald-500/40 text-emerald-300'
                : 'bg-white/[0.05] hover:bg-white/[0.1] border-white/[0.08] text-emerald-400 hover:text-emerald-300'
            }`}
          >
            <ShieldCheck className="w-4 h-4" />
          </button>

          {/* Leave */}
          <button
            onClick={onDisconnect}
            title="Leave room"
            className="w-9 h-9 rounded-xl bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 flex items-center justify-center text-red-400 hover:text-red-300 transition-colors flex-shrink-0"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* ── Offline banner ── */}
      {!isOnline && (
        <div className="flex items-center justify-center gap-2 bg-yellow-500/10 border-t border-yellow-500/20 px-4 py-1.5">
          <Loader2 className="w-3 h-3 text-yellow-400 animate-spin flex-shrink-0" />
          <span className="text-yellow-300 text-xs font-medium">
            Connection lost — reconnecting…
          </span>
        </div>
      )}

      {/* ── E2E info panel ── */}
      {showFpInfo && (
        <div className="border-t border-white/[0.06] bg-emerald-950/30 px-4 py-3">
          <div className="flex items-start gap-2">
            <ShieldCheck className="w-4 h-4 text-emerald-400 mt-0.5 flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-emerald-300 text-xs font-semibold">
                End-to-End Encrypted · AES-GCM 256-bit
              </p>
              <p className="text-slate-400 text-xs mt-0.5 leading-relaxed">
                Messages and files are encrypted in your browser. The relay broker only sees ciphertext — it cannot read anything.
              </p>
              {fingerprint && (
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <span className="text-slate-500 text-xs">Key:</span>
                  <span className="font-mono text-xs text-emerald-400 bg-emerald-950/50 border border-emerald-500/20 rounded px-2 py-0.5 tracking-widest">
                    {fingerprint}
                  </span>
                </div>
              )}
            </div>
            <button
              onClick={() => setShowFpInfo(false)}
              className="text-slate-500 hover:text-slate-300 text-xs flex-shrink-0"
            >
              ✕
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
