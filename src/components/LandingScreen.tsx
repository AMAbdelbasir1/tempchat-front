import React, { useState, useRef, useEffect } from 'react';
import { Zap, Link2, Users, FileUp, ArrowRight, Wifi, Server, ChevronDown } from 'lucide-react';

interface Props {
  onCreate: (name: string, serverUrl?: string) => void;
  onJoin: (code: string, name: string, serverUrl?: string) => void;
}

const SAVED_SERVER_KEY = 'templink_server_url';

export default function LandingScreen({ onCreate, onJoin }: Props) {
  const [tab, setTab]             = useState<'create' | 'join'>('create');
  const [name, setName]           = useState('');
  const [code, setCode]           = useState('');
  const [serverUrl, setServerUrl] = useState(() => localStorage.getItem(SAVED_SERVER_KEY) || '');
  const [showServer, setShowServer] = useState(() => !!localStorage.getItem(SAVED_SERVER_KEY));
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    nameRef.current?.focus();
  }, [tab]);

  const saveServer = (url: string) => {
    setServerUrl(url);
    if (url.trim()) {
      localStorage.setItem(SAVED_SERVER_KEY, url.trim());
    } else {
      localStorage.removeItem(SAVED_SERVER_KEY);
    }
  };

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    onCreate(name.trim(), serverUrl.trim() || undefined);
  };

  const handleJoin = (e: React.FormEvent) => {
    e.preventDefault();
    const roomCode = code.trim().toUpperCase();
    if (!name.trim() || !roomCode) return;
    onJoin(roomCode, name.trim(), serverUrl.trim() || undefined);
  };

  return (
    /*
     * ✅ FIX: min-h-screen + overflow-y-auto
     * On small screens with keyboard open, this content can be taller
     * than the viewport. Let it scroll naturally.
     * py-8 gives breathing room at top and bottom.
     */
    <div className="min-h-screen overflow-y-auto bg-gradient-to-br from-gray-950 via-slate-900 to-gray-950 flex flex-col items-center justify-center px-4 py-8">
      {/* Background grid */}
      <div className="absolute inset-0 bg-[linear-gradient(rgba(99,102,241,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(99,102,241,0.03)_1px,transparent_1px)] bg-[size:40px_40px] pointer-events-none" />

      <div className="relative w-full max-w-md">
        {/* Logo */}
        <div className="text-center mb-10">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-indigo-600 shadow-lg shadow-indigo-500/30 mb-4">
            <Zap className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-4xl font-black text-white tracking-tight">TempLink</h1>
          <p className="text-slate-400 mt-2 text-sm">Instant private chat &amp; file sharing — no signup needed</p>

          <div className="mt-3 inline-flex items-center gap-2 bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-xs px-3 py-1.5 rounded-full">
            <Wifi className="w-3.5 h-3.5" />
            Encrypted relay — works across any device &amp; network
          </div>
        </div>

        {/* Features */}
        <div className="grid grid-cols-3 gap-3 mb-8">
          {[
            { icon: Link2,  label: 'Share Link', desc: 'One-click invite' },
            { icon: Users,  label: 'Live Chat',  desc: 'Real-time relay'  },
            { icon: FileUp, label: 'Files',       desc: 'Drag & drop'     },
          ].map(({ icon: Icon, label, desc }) => (
            <div key={label} className="bg-white/[0.03] border border-white/[0.06] rounded-xl p-3 text-center">
              <Icon className="w-5 h-5 text-indigo-400 mx-auto mb-1" />
              <div className="text-white text-xs font-semibold">{label}</div>
              <div className="text-slate-500 text-[11px]">{desc}</div>
            </div>
          ))}
        </div>

        {/* Card */}
        <div className="bg-white/[0.04] border border-white/[0.08] rounded-2xl p-6 backdrop-blur-sm shadow-2xl">
          {/* Tabs */}
          <div className="flex bg-white/[0.05] rounded-xl p-1 mb-6">
            {(['create', 'join'] as const).map(t => (
              <button
                key={t}
                onClick={() => { setTab(t); setName(''); setCode(''); }}
                className={`flex-1 py-2 text-sm font-semibold rounded-lg transition-all duration-200 ${
                  tab === t
                    ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-500/20'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                {t === 'create' ? '✨ Create Room' : '🔗 Join Room'}
              </button>
            ))}
          </div>

          {tab === 'create' ? (
            <form onSubmit={handleCreate} className="space-y-4">
              <div>
                <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5 block">
                  Your Name
                </label>
                <input
                  ref={nameRef}
                  type="text"
                  placeholder="e.g. Alex"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  maxLength={30}
                  autoFocus
                  className="w-full bg-white/[0.06] border border-white/[0.1] rounded-xl px-4 py-3 text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/50 transition-all text-sm"
                />
              </div>

              {/* Server URL */}
              <div>
                <button
                  type="button"
                  onClick={() => setShowServer(!showServer)}
                  className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-300 transition-colors"
                >
                  <Server className="w-3.5 h-3.5" />
                  Custom server
                  <ChevronDown className={`w-3 h-3 transition-transform ${showServer ? 'rotate-180' : ''}`} />
                </button>
                {showServer && (
                  <div className="mt-2">
                    <input
                      type="text"
                      placeholder="e.g. localhost:3001 or myserver.com"
                      value={serverUrl}
                      onChange={e => saveServer(e.target.value)}
                      className="w-full bg-white/[0.04] border border-white/[0.08] rounded-xl px-4 py-2.5 text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500/50 focus:ring-1 focus:ring-indigo-500/30 transition-all text-xs font-mono"
                    />
                    <p className="text-[10px] text-slate-600 mt-1.5">
                      {serverUrl.trim()
                        ? '🖥️ Will connect to your server (fallback: public relays)'
                        : '📡 Leave empty to use free public relays (no setup needed)'}
                    </p>
                  </div>
                )}
              </div>

              <button
                type="submit"
                disabled={!name.trim()}
                className="w-full flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold py-3 rounded-xl transition-all duration-200 shadow-lg shadow-indigo-500/20 hover:shadow-indigo-500/30 hover:-translate-y-0.5 active:translate-y-0"
              >
                Create Room <ArrowRight className="w-4 h-4" />
              </button>
            </form>
          ) : (
            <form onSubmit={handleJoin} className="space-y-4">
              <div>
                <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5 block">
                  Your Name
                </label>
                <input
                  ref={nameRef}
                  type="text"
                  placeholder="e.g. Alex"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  maxLength={30}
                  autoFocus
                  className="w-full bg-white/[0.06] border border-white/[0.1] rounded-xl px-4 py-3 text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/50 transition-all text-sm"
                />
              </div>
              <div>
                <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5 block">
                  Room Code
                </label>
                <input
                  type="text"
                  placeholder="e.g. AB3X7K"
                  value={code}
                  onChange={e => setCode(e.target.value.toUpperCase())}
                  maxLength={8}
                  className="w-full bg-white/[0.06] border border-white/[0.1] rounded-xl px-4 py-3 text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/50 transition-all text-sm font-mono tracking-widest uppercase"
                />
              </div>

              {/* Server URL */}
              <div>
                <button
                  type="button"
                  onClick={() => setShowServer(!showServer)}
                  className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-300 transition-colors"
                >
                  <Server className="w-3.5 h-3.5" />
                  Custom server
                  <ChevronDown className={`w-3 h-3 transition-transform ${showServer ? 'rotate-180' : ''}`} />
                </button>
                {showServer && (
                  <div className="mt-2">
                    <input
                      type="text"
                      placeholder="e.g. localhost:3001 or myserver.com"
                      value={serverUrl}
                      onChange={e => saveServer(e.target.value)}
                      className="w-full bg-white/[0.04] border border-white/[0.08] rounded-xl px-4 py-2.5 text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500/50 focus:ring-1 focus:ring-indigo-500/30 transition-all text-xs font-mono"
                    />
                    <p className="text-[10px] text-slate-600 mt-1.5">
                      {serverUrl.trim()
                        ? '🖥️ Will connect to your server (fallback: public relays)'
                        : '📡 Leave empty to use free public relays (no setup needed)'}
                    </p>
                  </div>
                )}
              </div>

              <button
                type="submit"
                disabled={!name.trim() || !code.trim()}
                className="w-full flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold py-3 rounded-xl transition-all duration-200 shadow-lg shadow-indigo-500/20 hover:shadow-indigo-500/30 hover:-translate-y-0.5 active:translate-y-0"
              >
                Join Room <ArrowRight className="w-4 h-4" />
              </button>
            </form>
          )}
        </div>

        {/* ✅ FIX: Bottom text has margin so it's always scrollable into view */}
        <p className="text-center text-slate-600 text-xs mt-6 mb-8">
          Rooms are temporary — no data stored on any server
        </p>
      </div>
    </div>
  );
}