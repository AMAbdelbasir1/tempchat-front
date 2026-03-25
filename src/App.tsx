import { useState, useEffect } from 'react';
import { useChat } from './hooks/useChat';
import LandingScreen from './components/LandingScreen';
import ChatScreen from './components/ChatScreen';
import JoinScreen from './components/JoinScreen';
import DebugOverlay from './components/DebugOverlay';
import { Loader2 } from 'lucide-react';

// ── Read room code AND server URL from every source ──────────────────────
function detectRoomCode(): string {
  try {
    const qp = new URLSearchParams(window.location.search).get('room');
    if (qp?.trim()) return qp.trim().toUpperCase();
    const hp = new URLSearchParams(window.location.hash.replace(/^#\/?/, '')).get('room');
    if (hp?.trim()) return hp.trim().toUpperCase();
    const ss = sessionStorage.getItem('templink_room');
    if (ss?.trim()) return ss.trim().toUpperCase();
  } catch {}
  return '';
}

// ✅ NEW: Detect server URL from invite link
function detectServerUrl(): string {
  try {
    const qp = new URLSearchParams(window.location.search).get('server');
    if (qp?.trim()) return qp.trim();
    const hp = new URLSearchParams(window.location.hash.replace(/^#\/?/, '')).get('server');
    if (hp?.trim()) return hp.trim();
    const ss = sessionStorage.getItem('templink_server');
    if (ss?.trim()) return ss.trim();
  } catch {}
  return '';
}

const INITIAL_ROOM_CODE = detectRoomCode();
const INITIAL_SERVER_URL = detectServerUrl();

export default function App() {
  const [joinCode, setJoinCode]     = useState<string>(INITIAL_ROOM_CODE);
  const [joinServer, setJoinServer] = useState<string>(INITIAL_SERVER_URL);

  const {
    status, room, messages, peerCount, peers, error, fingerprint,
    isOnline, mode,
    createRoom, joinRoom, sendMessage, sendFile, sendLink, disconnect,
    editMessage, deleteMessage,
    activeCall, localStream, remoteStream, isAudioMuted, isVideoMuted,
    callError, startCall, acceptCall, rejectCall, hangup, toggleAudio, toggleVideo,
  } = useChat();

  useEffect(() => {
    if (!joinCode) {
      const ss = sessionStorage.getItem('templink_room');
      if (ss) setJoinCode(ss.trim().toUpperCase());
    }
    if (!joinServer) {
      const ss = sessionStorage.getItem('templink_server');
      if (ss) setJoinServer(ss.trim());
    }
  }, []); // eslint-disable-line

  // ✅ If server URL came from invite link, save to localStorage
  // so it persists for the user's future sessions
  useEffect(() => {
    if (INITIAL_SERVER_URL) {
      localStorage.setItem('templink_server_url', INITIAL_SERVER_URL);
    }
  }, []);

  const handleDisconnect = () => {
    sessionStorage.removeItem('templink_room');
    sessionStorage.removeItem('templink_server');
    setJoinCode('');
    setJoinServer('');
    disconnect();
  };

  const handleBack = () => {
    sessionStorage.removeItem('templink_room');
    sessionStorage.removeItem('templink_server');
    setJoinCode('');
    setJoinServer('');
    window.history.replaceState({}, '', window.location.pathname);
  };

  if (status === 'connecting') {
    const displayCode = room?.code || joinCode;
    return (
      <div className="min-h-screen bg-gray-950 flex flex-col items-center justify-center gap-4 px-4">
        <div className="w-16 h-16 rounded-2xl bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center">
          <Loader2 className="w-8 h-8 text-indigo-400 animate-spin" />
        </div>
        <p className="text-white font-semibold text-lg">Connecting to room…</p>
        {displayCode && (
          <p className="text-slate-400 text-sm font-mono tracking-widest">
            Room: <span className="text-indigo-400 font-bold">{displayCode}</span>
          </p>
        )}
        <div className="flex flex-col items-center gap-1 mt-1">
          <p className="text-slate-500 text-xs">Trying relay brokers — will keep retrying until connected.</p>
        </div>
        <button onClick={handleDisconnect}
          className="mt-4 text-slate-500 hover:text-slate-300 text-sm underline underline-offset-2 transition-colors">
          Cancel
        </button>
        <DebugOverlay />
      </div>
    );
  }

  if (room && status === 'connected') {
    return (
      <>
        <ChatScreen
          room={room} messages={messages} peerCount={peerCount} peers={peers}
          status={status} fingerprint={fingerprint} isOnline={isOnline} mode={mode}
          onSendMessage={sendMessage} onSendFile={sendFile} onSendLink={sendLink}
          onDisconnect={handleDisconnect}
          onEditMessage={editMessage} onDeleteMessage={deleteMessage}
          activeCall={activeCall} localStream={localStream} remoteStream={remoteStream}
          isAudioMuted={isAudioMuted} isVideoMuted={isVideoMuted} callError={callError}
          onStartVoiceCall={(id, name) => startCall(id, name, 'voice')}
          onStartVideoCall={(id, name) => startCall(id, name, 'video')}
          onAcceptCall={acceptCall} onRejectCall={rejectCall} onHangup={hangup}
          onToggleAudio={toggleAudio} onToggleVideo={toggleVideo}
        />
        <DebugOverlay />
      </>
    );
  }

  if (joinCode && status === 'idle') {
    return (
      <>
        {error && (
          <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 bg-red-500/10 border border-red-500/30 text-red-400 text-sm px-4 py-2 rounded-xl backdrop-blur-sm shadow-lg">
            ⚠️ {error}
          </div>
        )}
        <JoinScreen
          roomCode={joinCode}
          initialServerUrl={joinServer}
          onJoin={(code, name, serverUrl) => joinRoom(code, name, serverUrl)}
          onBack={handleBack}
        />
        <DebugOverlay />
      </>
    );
  }

  return (
    <>
      {error && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 bg-red-500/10 border border-red-500/30 text-red-400 text-sm px-4 py-2 rounded-xl backdrop-blur-sm shadow-lg">
          ⚠️ {error}
        </div>
      )}
      <LandingScreen
        onCreate={(name, serverUrl) => createRoom(name, serverUrl)}
        onJoin={(code, name, serverUrl) => joinRoom(code, name, serverUrl)}
      />
      <DebugOverlay />
    </>
  );
}