import { useState, useRef, useCallback, useEffect, KeyboardEvent } from 'react';
import { Send, Paperclip, Link2, X, FileText, Plus, Mic, Square, Pencil } from 'lucide-react';
import { useDropzone } from 'react-dropzone';
import type { Message } from '../types';

interface Props {
  onSendMessage: (text: string) => void;
  onSendFile: (file: File) => void;
  onSendLink: (url: string) => void;
  disabled?: boolean;
  // ✅ NEW: Edit mode
  editingMsg?: Message | null;
  onEditMessage?: (id: string, newContent: string) => void;
  onCancelEdit?: () => void;
}

function fmtDuration(sec: number) {
  const m = Math.floor(sec / 60).toString().padStart(2, '0');
  const s = (sec % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

export default function ChatInput({
  onSendMessage, onSendFile, onSendLink, disabled,
  editingMsg, onEditMessage, onCancelEdit,
}: Props) {
  const [text,       setText]       = useState('');
  const [linkMode,   setLinkMode]   = useState(false);
  const [linkUrl,    setLinkUrl]    = useState('');
  const [stagedFile, setStagedFile] = useState<File | null>(null);
  const [plusOpen,   setPlusOpen]   = useState(false);

  // Recording
  const [isRecording,    setIsRecording]    = useState(false);
  const [recordDuration, setRecordDuration] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordChunks     = useRef<Blob[]>([]);
  const recordTimerRef   = useRef<ReturnType<typeof setInterval> | null>(null);
  const recordStreamRef  = useRef<MediaStream | null>(null);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const plusRef     = useRef<HTMLDivElement>(null);

  // ✅ When entering edit mode, pre-fill the text
  useEffect(() => {
    if (editingMsg) {
      setText(editingMsg.content);
      setPlusOpen(false);
      setLinkMode(false);
      setStagedFile(null);
      // Focus the textarea
      setTimeout(() => {
        if (textareaRef.current) {
          textareaRef.current.focus();
          textareaRef.current.style.height = 'auto';
          textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 120) + 'px';
        }
      }, 50);
    }
  }, [editingMsg]);

  useEffect(() => {
    return () => { stopRecordingCleanup(); };
  }, []);

  const onDrop = useCallback((accepted: File[]) => {
    if (accepted.length > 0) {
      setStagedFile(accepted[0]);
      setPlusOpen(false);
      setLinkMode(false);
    }
  }, []);

  const { getRootProps, getInputProps, isDragActive, open } = useDropzone({
    onDrop, noClick: true, noKeyboard: true,
  });

  // ── Send / Edit ──────────────────────────────────────────
  const handleSendText = () => {
    if (!text.trim()) return;

    // ✅ If editing, call edit handler instead of send
    if (editingMsg && onEditMessage) {
      onEditMessage(editingMsg.id, text.trim());
      setText('');
      if (textareaRef.current) textareaRef.current.style.height = 'auto';
      return;
    }

    onSendMessage(text.trim());
    setText('');
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
  };

  const handleCancelEdit = () => {
    setText('');
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
    onCancelEdit?.();
  };

  const handleSendFile = () => {
    if (!stagedFile) return;
    onSendFile(stagedFile);
    setStagedFile(null);
  };

  const handleSendLink = () => {
    let url = linkUrl.trim();
    if (!url) return;
    if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
    onSendLink(url);
    setLinkUrl('');
    setLinkMode(false);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendText();
    }
    if (e.key === 'Escape' && editingMsg) {
      handleCancelEdit();
    }
  };

  const handleTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setText(e.target.value);
    e.target.style.height = 'auto';
    e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px';
  };

  const formatBytes = (b: number) =>
    b < 1024 ? `${b} B` : b < 1048576 ? `${(b / 1024).toFixed(1)} KB` : `${(b / 1048576).toFixed(1)} MB`;

  const openFilePicker = () => { open(); setPlusOpen(false); };
  const openLinkMode   = () => { setLinkMode(true); setPlusOpen(false); };

  // ── Recording ─────────────────────────────────────────────
  const stopRecordingCleanup = useCallback(() => {
    if (recordTimerRef.current) { clearInterval(recordTimerRef.current); recordTimerRef.current = null; }
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      try { mediaRecorderRef.current.stop(); } catch { /* */ }
    }
    mediaRecorderRef.current = null;
    if (recordStreamRef.current) {
      recordStreamRef.current.getTracks().forEach(t => t.stop());
      recordStreamRef.current = null;
    }
    recordChunks.current = [];
  }, []);

  const startRecording = useCallback(async () => {
    if (disabled || isRecording || editingMsg) return;
    setPlusOpen(false); setLinkMode(false); setStagedFile(null);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      recordStreamRef.current = stream;
      const mimeType = ['audio/webm;codecs=opus','audio/webm','audio/ogg;codecs=opus','audio/mp4','audio/wav']
        .find(t => MediaRecorder.isTypeSupported(t)) || '';

      const recorder = new MediaRecorder(stream, {
        mimeType: mimeType || undefined, audioBitsPerSecond: 64000,
      });
      recordChunks.current = [];
      recorder.ondataavailable = (e) => { if (e.data.size > 0) recordChunks.current.push(e.data); };
      recorder.onstop = () => {
        const chunks = recordChunks.current;
        if (chunks.length === 0) { stopRecordingCleanup(); setIsRecording(false); setRecordDuration(0); return; }
        const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' });
        let ext = 'webm';
        if (recorder.mimeType?.includes('ogg')) ext = 'ogg';
        if (recorder.mimeType?.includes('mp4')) ext = 'mp4';
        const timestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const file = new File([blob], `Voice ${timestamp}.${ext}`, { type: recorder.mimeType || 'audio/webm' });
        onSendFile(file);
        stopRecordingCleanup(); setIsRecording(false); setRecordDuration(0);
      };
      recorder.onerror = () => { stopRecordingCleanup(); setIsRecording(false); setRecordDuration(0); };
      recorder.start(1000);
      mediaRecorderRef.current = recorder;
      setIsRecording(true); setRecordDuration(0);
      recordTimerRef.current = setInterval(() => setRecordDuration(p => p + 1), 1000);
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      if (msg.toLowerCase().includes('permission') || msg.toLowerCase().includes('denied')) {
        alert('Microphone permission denied.');
      }
    }
  }, [disabled, isRecording, editingMsg, onSendFile, stopRecordingCleanup]);

  const stopRecording = useCallback(() => {
    if (recordTimerRef.current) { clearInterval(recordTimerRef.current); recordTimerRef.current = null; }
    if (mediaRecorderRef.current?.state !== 'inactive') mediaRecorderRef.current?.stop();
    if (recordStreamRef.current) { recordStreamRef.current.getTracks().forEach(t => t.stop()); recordStreamRef.current = null; }
  }, []);

  const cancelRecording = useCallback(() => {
    if (mediaRecorderRef.current) mediaRecorderRef.current.onstop = null;
    stopRecordingCleanup(); setIsRecording(false); setRecordDuration(0);
  }, [stopRecordingCleanup]);

  const rootProps = getRootProps();

  return (
    <div
      {...rootProps}
      className={`flex-shrink-0 relative border-t border-white/[0.06] bg-gray-950/95 backdrop-blur-md transition-colors duration-200
        ${isDragActive ? 'border-indigo-500/50 bg-indigo-950/30' : ''}`}
      style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
    >
      <input {...getInputProps()} />

      {isDragActive && (
        <div className="absolute inset-0 flex items-center justify-center z-10 pointer-events-none bg-indigo-950/50 rounded-t-xl">
          <div className="flex flex-col items-center gap-2 text-indigo-300">
            <Paperclip className="w-8 h-8" />
            <span className="font-semibold text-sm">Drop to send file</span>
          </div>
        </div>
      )}

      <div className="px-3 py-2.5 space-y-2">

        {/* ── Edit mode bar ── */}
        {editingMsg && !isRecording && (
          <div className="flex items-center gap-2 bg-indigo-600/10 border border-indigo-500/20 rounded-xl px-3 py-2">
            <Pencil className="w-4 h-4 text-indigo-400 flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-xs text-indigo-300 font-semibold">Editing message</p>
              <p className="text-xs text-slate-400 truncate">{editingMsg.content}</p>
            </div>
            <button onClick={handleCancelEdit} className="text-slate-500 hover:text-slate-300 transition-colors p-1">
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* ── Recording UI ── */}
        {isRecording && (
          <div className="flex items-center gap-3 bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3">
            <div className="relative flex-shrink-0">
              <div className="w-3 h-3 bg-red-500 rounded-full animate-pulse" />
              <div className="absolute inset-0 w-3 h-3 bg-red-500 rounded-full animate-ping opacity-40" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-red-300 text-sm font-semibold">Recording {fmtDuration(recordDuration)}</p>
              <p className="text-red-400/60 text-xs">Tap stop to send, cancel to discard</p>
            </div>
            <button onClick={cancelRecording}
              className="flex items-center gap-1.5 text-slate-400 hover:text-slate-200 text-xs font-medium px-2.5 py-1.5 rounded-lg bg-white/[0.05] hover:bg-white/[0.1] border border-white/[0.08] transition-colors flex-shrink-0">
              <X className="w-3.5 h-3.5" /> Cancel
            </button>
            <button onClick={stopRecording}
              className="flex items-center gap-1.5 bg-red-600 hover:bg-red-500 text-white text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors flex-shrink-0 active:scale-95">
              <Square className="w-3 h-3 fill-current" /> Send
            </button>
          </div>
        )}

        {/* ── Staged file ── */}
        {!isRecording && !editingMsg && stagedFile && (
          <div className="flex items-center gap-2 bg-indigo-600/10 border border-indigo-500/20 rounded-xl px-3 py-2">
            <FileText className="w-4 h-4 text-indigo-400 flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm text-white font-medium truncate">{stagedFile.name}</p>
              <p className="text-xs text-slate-400">{formatBytes(stagedFile.size)}</p>
            </div>
            <button onClick={() => setStagedFile(null)} className="text-slate-500 hover:text-slate-300 p-1"><X className="w-4 h-4" /></button>
            <button onClick={handleSendFile} disabled={disabled}
              className="flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors flex-shrink-0">
              <Send className="w-3.5 h-3.5" /> Send
            </button>
          </div>
        )}

        {/* ── Link mode ── */}
        {!isRecording && !editingMsg && linkMode && (
          <div className="flex items-center gap-2 bg-white/[0.04] border border-white/[0.08] rounded-xl px-3 py-2">
            <Link2 className="w-4 h-4 text-indigo-400 flex-shrink-0" />
            <input type="url" placeholder="https://example.com" value={linkUrl}
              onChange={e => setLinkUrl(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleSendLink(); if (e.key === 'Escape') setLinkMode(false); }}
              autoFocus className="flex-1 bg-transparent text-white text-sm placeholder-slate-500 focus:outline-none min-w-0" />
            <button onClick={() => setLinkMode(false)} className="text-slate-500 hover:text-slate-300 p-1"><X className="w-4 h-4" /></button>
            <button onClick={handleSendLink} disabled={!linkUrl.trim() || disabled}
              className="flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors flex-shrink-0">
              <Send className="w-3.5 h-3.5" /> Send
            </button>
          </div>
        )}

        {/* ── Main input row ── */}
        {!isRecording && !stagedFile && !linkMode && (
          <div className="flex items-end gap-2">
            {/* + button — hidden during edit mode */}
            {!editingMsg && (
              <div className="relative flex-shrink-0" ref={plusRef}>
                {plusOpen && (
                  <div className="absolute bottom-full left-0 mb-2 flex flex-col gap-2 z-30">
                    <button onClick={openFilePicker}
                      className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold px-3 py-2 rounded-xl shadow-lg transition-all active:scale-95 whitespace-nowrap">
                      <Paperclip className="w-3.5 h-3.5" /> Send File
                    </button>
                    <button onClick={openLinkMode}
                      className="flex items-center gap-2 bg-slate-700 hover:bg-slate-600 text-white text-xs font-semibold px-3 py-2 rounded-xl shadow-lg transition-all active:scale-95 whitespace-nowrap">
                      <Link2 className="w-3.5 h-3.5" /> Send Link
                    </button>
                  </div>
                )}
                <button onClick={() => setPlusOpen(v => !v)} disabled={disabled} title="Attach file or send link"
                  className={`w-10 h-10 rounded-xl border flex items-center justify-center transition-all active:scale-95 disabled:opacity-40 ${
                    plusOpen ? 'bg-indigo-600 border-indigo-500 text-white rotate-45'
                             : 'bg-white/[0.05] hover:bg-white/[0.1] border-white/[0.08] text-slate-400 hover:text-slate-200'
                  }`}>
                  <Plus className="w-5 h-5 transition-transform duration-200" />
                </button>
              </div>
            )}

            {/* Text area */}
            <div className="flex-1 bg-white/[0.05] border border-white/[0.08] rounded-xl px-3 py-2.5 focus-within:border-indigo-500/50 focus-within:ring-1 focus-within:ring-indigo-500/20 transition-all min-w-0">
              <textarea
                ref={textareaRef} value={text} onChange={handleTextChange} onKeyDown={handleKeyDown}
                disabled={disabled}
                placeholder={editingMsg ? 'Edit message… (Esc to cancel)' : disabled ? 'Connecting…' : 'Message… (Enter to send)'}
                rows={1}
                className="w-full bg-transparent text-white text-sm placeholder-slate-500 focus:outline-none resize-none leading-relaxed disabled:opacity-40"
                style={{ minHeight: '22px', maxHeight: '120px' }}
              />
            </div>

            {/* Send / Mic button */}
            {text.trim() ? (
              <button onClick={handleSendText} disabled={disabled}
                className={`flex-shrink-0 w-10 h-10 rounded-xl flex items-center justify-center text-white transition-all active:scale-95 shadow-lg disabled:opacity-40 disabled:cursor-not-allowed ${
                  editingMsg ? 'bg-emerald-600 hover:bg-emerald-500 shadow-emerald-500/20' : 'bg-indigo-600 hover:bg-indigo-500 shadow-indigo-500/20'
                }`}>
                {editingMsg ? <Pencil className="w-4 h-4" /> : <Send className="w-4 h-4" />}
              </button>
            ) : !editingMsg ? (
              <button onClick={startRecording} disabled={disabled} title="Record voice message"
                className="flex-shrink-0 w-10 h-10 rounded-xl bg-white/[0.05] hover:bg-red-500/20 border border-white/[0.08] hover:border-red-500/30 disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center text-slate-400 hover:text-red-400 transition-all active:scale-95">
                <Mic className="w-4 h-4" />
              </button>
            ) : (
              <button onClick={handleCancelEdit}
                className="flex-shrink-0 w-10 h-10 rounded-xl bg-white/[0.05] border border-white/[0.08] flex items-center justify-center text-slate-400 hover:text-slate-200 transition-all active:scale-95">
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}