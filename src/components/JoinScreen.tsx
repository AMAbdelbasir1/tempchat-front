import React, { useState, useRef, useEffect } from 'react';
import { Zap, ArrowRight, LogIn, ArrowLeft, Server, ChevronDown } from 'lucide-react';

const SAVED_SERVER_KEY = 'templink_server_url';

interface Props {
  roomCode: string;
  initialServerUrl?: string;  // ✅ NEW: from invite link
  onJoin: (code: string, name: string, serverUrl?: string) => void;
  onBack?: () => void;
}

export default function JoinScreen({ roomCode, initialServerUrl, onJoin, onBack }: Props) {
  const [name, setName] = useState('');
  const [serverUrl, setServerUrl] = useState(() => {
    // Priority: invite link > localStorage > empty
    return initialServerUrl || localStorage.getItem(SAVED_SERVER_KEY) || '';
  });
  const [showServer, setShowServer] = useState(() => {
    return !!(initialServerUrl || localStorage.getItem(SAVED_SERVER_KEY));
  });
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const t = setTimeout(() => nameRef.current?.focus(), 200);
    return () => clearTimeout(t);
  }, []);

  // ✅ If initialServerUrl changes (e.g. from URL), update
  useEffect(() => {
    if (initialServerUrl) {
      setServerUrl(initialServerUrl);
      setShowServer(true);
      localStorage.setItem(SAVED_SERVER_KEY, initialServerUrl);
    }
  }, [initialServerUrl]);

  const saveServer = (url: string) => {
    setServerUrl(url);
    if (url.trim()) localStorage.setItem(SAVED_SERVER_KEY, url.trim());
    else localStorage.removeItem(SAVED_SERVER_KEY);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    onJoin(roomCode, trimmed, serverUrl.trim() || undefined);
  };

  const handleBack = () => {
    if (onBack) onBack();
    else { window.history.replaceState({}, '', window.location.pathname); window.location.reload(); }
  };

  return (
    <div className="min-h-screen overflow-y-auto bg-gradient-to-br from-gray-950 via-slate-900 to-gray-950 flex flex-col items-center justify-center px-4 py-8">
      <div className="absolute inset-0 bg-[linear-gradient(rgba(99,102,241,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(99,102,241,0.03)_1px,transparent_1px)] bg-[size:40px_40px] pointer-events-none" />
      <div className="relative w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-indigo-600 shadow-lg shadow-indigo-500/30 mb-3">
            <Zap className="w-7 h-7 text-white" />
          </div>
          <h1 className="text-3xl font-black text-white tracking-tight">TempLink</h1>
          <p className="text-slate-400 text-sm mt-1">Instant private chat &amp; file sharing</p>
        </div>

        <div className="mb-5 flex items-center gap-3 bg-indigo-500/10 border border-indigo-500/40 rounded-2xl px-5 py-4">
          <div className="flex-shrink-0 w-10 h-10 rounded-xl bg-indigo-600/30 border border-indigo-500/40 flex items-center justify-center">
            <LogIn className="w-5 h-5 text-indigo-300" />
          </div>
          <div>
            <p className="text-indigo-200 text-sm font-bold">You've been invited!</p>
            <p className="text-indigo-400/80 text-xs mt-0.5">
              Room: <span className="font-mono font-black text-indigo-300 text-sm tracking-widest">{roomCode}</span>
            </p>
            {/* ✅ Show server info if auto-detected from link */}
            {serverUrl && (
              <p className="text-emerald-400/70 text-[10px] mt-0.5">
                🖥️ Server: {serverUrl}
              </p>
            )}
          </div>
        </div>

        <div className="bg-white/[0.04] border border-white/[0.08] rounded-2xl p-6 backdrop-blur-sm shadow-2xl">
          <h2 className="text-white font-bold text-lg mb-1">Enter your name to join</h2>
          <p className="text-slate-400 text-sm mb-5">You'll join the private chat room instantly.</p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="bg-white/[0.03] border border-white/[0.06] rounded-xl px-4 py-3 flex items-center justify-between">
              <span className="text-slate-400 text-xs font-semibold uppercase tracking-wider">Room</span>
              <span className="text-white font-mono font-black text-xl tracking-[0.25em]">{roomCode}</span>
            </div>

            <div>
              <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5 block">Your Name</label>
              <input ref={nameRef} type="text" placeholder="e.g. Alex" value={name}
                onChange={e => setName(e.target.value)} maxLength={30} autoComplete="off" autoCapitalize="words"
                className="w-full bg-white/[0.06] border border-white/[0.1] rounded-xl px-4 py-3 text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/50 transition-all text-sm" />
            </div>

            <div>
              <button type="button" onClick={() => setShowServer(!showServer)}
                className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-300 transition-colors">
                <Server className="w-3.5 h-3.5" /> Custom server
                <ChevronDown className={`w-3 h-3 transition-transform ${showServer ? 'rotate-180' : ''}`} />
              </button>
              {showServer && (
                <div className="mt-2">
                  <input type="text" placeholder="e.g. localhost:3001" value={serverUrl}
                    onChange={e => saveServer(e.target.value)}
                    className="w-full bg-white/[0.04] border border-white/[0.08] rounded-xl px-4 py-2.5 text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500/50 focus:ring-1 focus:ring-indigo-500/30 transition-all text-xs font-mono" />
                  <p className="text-[10px] text-slate-600 mt-1.5">
                    {serverUrl.trim()
                      ? initialServerUrl ? '🔗 Auto-detected from invite link' : '🖥️ Will use your server'
                      : '📡 Leave empty for public relays'}
                  </p>
                </div>
              )}
            </div>

            <button type="submit" disabled={!name.trim()}
              className="w-full flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold py-3.5 rounded-xl transition-all duration-200 shadow-lg shadow-indigo-500/20 text-base">
              Join Room <ArrowRight className="w-5 h-5" />
            </button>
          </form>
        </div>

        <button onClick={handleBack}
          className="mt-5 mb-8 w-full flex items-center justify-center gap-2 text-slate-500 hover:text-slate-300 text-sm transition-colors">
          <ArrowLeft className="w-4 h-4" /> Create my own room instead
        </button>
      </div>
    </div>
  );
}