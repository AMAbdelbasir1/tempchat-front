/**
 * DebugOverlay — floating on-screen console for mobile debugging.
 * 
 * Shows all console.log/warn/error messages on screen.
 * Toggle with a small floating button.
 * 
 * Remove this component from App.tsx when done debugging.
 */

import { useState, useEffect, useRef } from 'react';

interface LogEntry {
  id: number;
  level: 'log' | 'warn' | 'error';
  time: string;
  text: string;
}

let logId = 0;
const logBuffer: LogEntry[] = [];
let listeners: Array<() => void> = [];

function addLog(level: LogEntry['level'], args: unknown[]) {
  const time = new Date().toLocaleTimeString([], { 
    hour: '2-digit', minute: '2-digit', second: '2-digit' 
  });
  const text = args.map(a => {
    if (typeof a === 'string') return a;
    try { return JSON.stringify(a, null, 0); }
    catch { return String(a); }
  }).join(' ');

  logBuffer.push({ id: logId++, level, time, text });

  // Keep last 200 logs
  if (logBuffer.length > 200) logBuffer.shift();

  listeners.forEach(fn => fn());
}

// Intercept console methods
const origLog   = console.log.bind(console);
const origWarn  = console.warn.bind(console);
const origError = console.error.bind(console);

let intercepted = false;

function startIntercept() {
  if (intercepted) return;
  intercepted = true;

  console.log = (...args: unknown[]) => {
    origLog(...args);
    addLog('log', args);
  };
  console.warn = (...args: unknown[]) => {
    origWarn(...args);
    addLog('warn', args);
  };
  console.error = (...args: unknown[]) => {
    origError(...args);
    addLog('error', args);
  };

  // Also catch unhandled errors
  window.addEventListener('error', (e) => {
    addLog('error', [`[Uncaught] ${e.message} at ${e.filename}:${e.lineno}`]);
  });

  window.addEventListener('unhandledrejection', (e) => {
    addLog('error', [`[Unhandled Promise] ${e.reason}`]);
  });
}

export default function DebugOverlay() {
  const [open, setOpen]       = useState(false);
  const [logs, setLogs]       = useState<LogEntry[]>([]);
  const [filter, setFilter]   = useState<'all' | 'call'>('call');
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    startIntercept();

    const update = () => setLogs([...logBuffer]);
    listeners.push(update);

    return () => {
      listeners = listeners.filter(fn => fn !== update);
    };
  }, []);

  useEffect(() => {
    if (open) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs, open]);

  const filtered = filter === 'all' 
    ? logs 
    : logs.filter(l => 
        l.text.includes('[WebRTC]') || 
        l.text.includes('[Call]') || 
        l.text.includes('[WsRelay]') ||
        l.text.includes('ICE') ||
        l.text.includes('track') ||
        l.text.includes('stream') ||
        l.text.includes('SDP') ||
        l.level === 'error' ||
        l.level === 'warn'
      );

  const levelColor = (level: LogEntry['level']) => {
    switch (level) {
      case 'error': return 'text-red-400 bg-red-500/10';
      case 'warn':  return 'text-yellow-400 bg-yellow-500/10';
      default:      return 'text-green-300 bg-transparent';
    }
  };

  return (
    <>
      {/* Floating toggle button */}
      <button
        onClick={() => setOpen(v => !v)}
        className="fixed bottom-20 right-3 z-[9999] w-10 h-10 rounded-full bg-red-600 text-white text-xs font-bold shadow-lg flex items-center justify-center active:scale-95"
        style={{ fontSize: '10px' }}
      >
        {open ? '✕' : '🐛'}
      </button>

      {/* Log panel */}
      {open && (
        <div className="fixed inset-x-0 bottom-0 z-[9998] h-[60vh] bg-black/95 border-t border-white/10 flex flex-col">
          
          {/* Header */}
          <div className="flex items-center gap-2 px-3 py-2 border-b border-white/10 flex-shrink-0">
            <span className="text-white text-xs font-bold">Console</span>
            <span className="text-slate-500 text-xs">({filtered.length})</span>
            
            {/* Filter buttons */}
            <button
              onClick={() => setFilter('call')}
              className={`text-xs px-2 py-0.5 rounded ${
                filter === 'call' ? 'bg-indigo-600 text-white' : 'bg-white/10 text-slate-400'
              }`}
            >
              Call
            </button>
            <button
              onClick={() => setFilter('all')}
              className={`text-xs px-2 py-0.5 rounded ${
                filter === 'all' ? 'bg-indigo-600 text-white' : 'bg-white/10 text-slate-400'
              }`}
            >
              All
            </button>

            <div className="flex-1" />

            {/* Clear */}
            <button
              onClick={() => { logBuffer.length = 0; setLogs([]); }}
              className="text-xs text-red-400 px-2 py-0.5 bg-red-500/10 rounded"
            >
              Clear
            </button>

            {/* Copy all */}
            <button
              onClick={() => {
                const text = filtered.map(l => `[${l.time}] [${l.level}] ${l.text}`).join('\n');
                navigator.clipboard.writeText(text).then(() => alert('Logs copied!'));
              }}
              className="text-xs text-blue-400 px-2 py-0.5 bg-blue-500/10 rounded"
            >
              Copy
            </button>
          </div>

          {/* Logs */}
          <div className="flex-1 overflow-y-auto px-2 py-1 font-mono" style={{ fontSize: '10px' }}>
            {filtered.length === 0 && (
              <p className="text-slate-600 text-center mt-4">No logs yet</p>
            )}
            {filtered.map(log => (
              <div
                key={log.id}
                className={`py-0.5 px-1 rounded mb-0.5 leading-tight ${levelColor(log.level)}`}
              >
                <span className="text-slate-600">{log.time}</span>{' '}
                <span className="break-all">{log.text}</span>
              </div>
            ))}
            <div ref={bottomRef} />
          </div>
        </div>
      )}
    </>
  );
}