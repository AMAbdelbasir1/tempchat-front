import { useState, useRef, useCallback, useEffect, KeyboardEvent } from 'react';
import { Send, Paperclip, Link2, X, FileText, Plus, Mic, Square } from 'lucide-react';
import { useDropzone } from 'react-dropzone';

interface Props {
  onSendMessage: (text: string) => void;
  onSendFile: (file: File) => void;
  onSendLink: (url: string) => void;
  disabled?: boolean;
}

/** Format seconds as MM:SS */
function fmtDuration(sec: number) {
  const m = Math.floor(sec / 60).toString().padStart(2, '0');
  const s = (sec % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

export default function ChatInput({ onSendMessage, onSendFile, onSendLink, disabled }: Props) {
  const [text,       setText]       = useState('');
  const [linkMode,   setLinkMode]   = useState(false);
  const [linkUrl,    setLinkUrl]    = useState('');
  const [stagedFile, setStagedFile] = useState<File | null>(null);
  const [plusOpen,   setPlusOpen]   = useState(false);

  // ── Recording state ──
  const [isRecording,    setIsRecording]    = useState(false);
  const [recordDuration, setRecordDuration] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordChunks     = useRef<Blob[]>([]);
  const recordTimerRef   = useRef<ReturnType<typeof setInterval> | null>(null);
  const recordStreamRef  = useRef<MediaStream | null>(null);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const plusRef     = useRef<HTMLDivElement>(null);

  // Cleanup recording on unmount
  useEffect(() => {
    return () => {
      stopRecordingCleanup();
    };
  }, []);

  const onDrop = useCallback((accepted: File[]) => {
    if (accepted.length > 0) {
      setStagedFile(accepted[0]);
      setPlusOpen(false);
      setLinkMode(false);
    }
  }, []);

  const { getRootProps, getInputProps, isDragActive, open } = useDropzone({
    onDrop,
    noClick: true,
    noKeyboard: true,
  });

  const handleSendText = () => {
    if (!text.trim()) return;
    onSendMessage(text.trim());
    setText('');
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
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
  };

  const handleTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setText(e.target.value);
    e.target.style.height = 'auto';
    e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px';
  };

  const formatBytes = (b: number) =>
    b < 1024
      ? `${b} B`
      : b < 1048576
        ? `${(b / 1024).toFixed(1)} KB`
        : `${(b / 1048576).toFixed(1)} MB`;

  const openFilePicker = () => { open(); setPlusOpen(false); };
  const openLinkMode   = () => { setLinkMode(true); setPlusOpen(false); };

  // ── Recording helpers ──────────────────────────────────────────────────

  /** Clean up all recording resources */
  const stopRecordingCleanup = useCallback(() => {
    if (recordTimerRef.current) {
      clearInterval(recordTimerRef.current);
      recordTimerRef.current = null;
    }
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

  /** Start voice recording */
  const startRecording = useCallback(async () => {
    if (disabled || isRecording) return;

    // Close other modes
    setPlusOpen(false);
    setLinkMode(false);
    setStagedFile(null);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      recordStreamRef.current = stream;

      // Pick best supported format
      const mimeType = [
        'audio/webm;codecs=opus',
        'audio/webm',
        'audio/ogg;codecs=opus',
        'audio/mp4',
        'audio/wav',
      ].find(t => MediaRecorder.isTypeSupported(t)) || '';

      const recorder = new MediaRecorder(stream, {
        mimeType: mimeType || undefined,
        audioBitsPerSecond: 64000, // 64kbps — good quality, small size
      });

      recordChunks.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          recordChunks.current.push(e.data);
        }
      };

      recorder.onstop = () => {
        // Build the audio file from chunks
        const chunks = recordChunks.current;
        if (chunks.length === 0) {
          console.warn('[Recording] No audio data captured');
          stopRecordingCleanup();
          setIsRecording(false);
          setRecordDuration(0);
          return;
        }

        const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' });

        // Determine file extension from mime type
        let ext = 'webm';
        if (recorder.mimeType) {
          if (recorder.mimeType.includes('ogg'))  ext = 'ogg';
          if (recorder.mimeType.includes('mp4'))  ext = 'mp4';
          if (recorder.mimeType.includes('wav'))  ext = 'wav';
        }

        const timestamp = new Date().toLocaleTimeString([], {
          hour: '2-digit',
          minute: '2-digit',
        });
        const fileName = `Voice ${timestamp}.${ext}`;

        const file = new File([blob], fileName, { type: recorder.mimeType || 'audio/webm' });

        console.log(`[Recording] Sending: ${fileName} (${formatBytes(file.size)})`);
        onSendFile(file);

        // Cleanup
        stopRecordingCleanup();
        setIsRecording(false);
        setRecordDuration(0);
      };

      recorder.onerror = (e) => {
        console.error('[Recording] Error:', e);
        stopRecordingCleanup();
        setIsRecording(false);
        setRecordDuration(0);
      };

      // Request data every 1 second so we get chunks incrementally
      recorder.start(1000);
      mediaRecorderRef.current = recorder;
      setIsRecording(true);
      setRecordDuration(0);

      // Duration counter
      recordTimerRef.current = setInterval(() => {
        setRecordDuration(prev => prev + 1);
      }, 1000);

      console.log(`[Recording] Started — format: ${mimeType || 'default'}`);
    } catch (err) {
      console.error('[Recording] Mic access error:', err);
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.toLowerCase().includes('permission') || msg.toLowerCase().includes('denied')) {
        alert('Microphone permission denied. Please allow microphone access to record voice messages.');
      }
    }
  }, [disabled, isRecording, onSendFile, stopRecordingCleanup]);

  /** Stop recording — triggers onstop which sends the file */
  const stopRecording = useCallback(() => {
    if (!mediaRecorderRef.current) return;

    // Stop the timer immediately
    if (recordTimerRef.current) {
      clearInterval(recordTimerRef.current);
      recordTimerRef.current = null;
    }

    // Stop the recorder — this triggers onstop callback
    if (mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }

    // Stop mic stream
    if (recordStreamRef.current) {
      recordStreamRef.current.getTracks().forEach(t => t.stop());
      recordStreamRef.current = null;
    }
  }, []);

  /** Cancel recording without sending */
  const cancelRecording = useCallback(() => {
    // Remove onstop handler so it doesn't send
    if (mediaRecorderRef.current) {
      mediaRecorderRef.current.onstop = null;
    }
    stopRecordingCleanup();
    setIsRecording(false);
    setRecordDuration(0);
  }, [stopRecordingCleanup]);

  const rootProps = getRootProps();

  return (
    <div
      {...rootProps}
      className={`
        flex-shrink-0
        relative
        border-t border-white/[0.06]
        bg-gray-950/95
        backdrop-blur-md
        transition-colors duration-200
        ${isDragActive ? 'border-indigo-500/50 bg-indigo-950/30' : ''}
      `}
      style={{
        paddingBottom: 'env(safe-area-inset-bottom, 0px)',
      }}
    >
      <input {...getInputProps()} />

      {/* Drag overlay */}
      {isDragActive && (
        <div className="absolute inset-0 flex items-center justify-center z-10 pointer-events-none bg-indigo-950/50 rounded-t-xl">
          <div className="flex flex-col items-center gap-2 text-indigo-300">
            <Paperclip className="w-8 h-8" />
            <span className="font-semibold text-sm">Drop to send file</span>
          </div>
        </div>
      )}

      <div className="px-3 py-2.5 space-y-2">

        {/* ── Recording UI ── */}
        {isRecording && (
          <div className="flex items-center gap-3 bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3">
            {/* Pulsing red dot */}
            <div className="relative flex-shrink-0">
              <div className="w-3 h-3 bg-red-500 rounded-full animate-pulse" />
              <div className="absolute inset-0 w-3 h-3 bg-red-500 rounded-full animate-ping opacity-40" />
            </div>

            {/* Duration */}
            <div className="flex-1 min-w-0">
              <p className="text-red-300 text-sm font-semibold">
                Recording {fmtDuration(recordDuration)}
              </p>
              <p className="text-red-400/60 text-xs">
                Tap stop to send, cancel to discard
              </p>
            </div>

            {/* Cancel */}
            <button
              onClick={cancelRecording}
              className="flex items-center gap-1.5 text-slate-400 hover:text-slate-200 text-xs font-medium px-2.5 py-1.5 rounded-lg bg-white/[0.05] hover:bg-white/[0.1] border border-white/[0.08] transition-colors flex-shrink-0"
            >
              <X className="w-3.5 h-3.5" />
              Cancel
            </button>

            {/* Stop & send */}
            <button
              onClick={stopRecording}
              className="flex items-center gap-1.5 bg-red-600 hover:bg-red-500 text-white text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors flex-shrink-0 active:scale-95"
            >
              <Square className="w-3 h-3 fill-current" />
              Send
            </button>
          </div>
        )}

        {/* ── Staged file preview ── */}
        {!isRecording && stagedFile && (
          <div className="flex items-center gap-2 bg-indigo-600/10 border border-indigo-500/20 rounded-xl px-3 py-2">
            <FileText className="w-4 h-4 text-indigo-400 flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm text-white font-medium truncate">{stagedFile.name}</p>
              <p className="text-xs text-slate-400">{formatBytes(stagedFile.size)}</p>
            </div>
            <button onClick={() => setStagedFile(null)} className="text-slate-500 hover:text-slate-300 transition-colors p-1">
              <X className="w-4 h-4" />
            </button>
            <button
              onClick={handleSendFile}
              disabled={disabled}
              className="flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors flex-shrink-0"
            >
              <Send className="w-3.5 h-3.5" />
              Send
            </button>
          </div>
        )}

        {/* ── Link mode ── */}
        {!isRecording && linkMode && (
          <div className="flex items-center gap-2 bg-white/[0.04] border border-white/[0.08] rounded-xl px-3 py-2">
            <Link2 className="w-4 h-4 text-indigo-400 flex-shrink-0" />
            <input
              type="url"
              placeholder="https://example.com"
              value={linkUrl}
              onChange={e => setLinkUrl(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') handleSendLink();
                if (e.key === 'Escape') setLinkMode(false);
              }}
              autoFocus
              className="flex-1 bg-transparent text-white text-sm placeholder-slate-500 focus:outline-none min-w-0"
            />
            <button onClick={() => setLinkMode(false)} className="text-slate-500 hover:text-slate-300 p-1">
              <X className="w-4 h-4" />
            </button>
            <button
              onClick={handleSendLink}
              disabled={!linkUrl.trim() || disabled}
              className="flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors flex-shrink-0"
            >
              <Send className="w-3.5 h-3.5" />
              Send
            </button>
          </div>
        )}

        {/* ── Main input row ── */}
        {!isRecording && !stagedFile && !linkMode && (
          <div className="flex items-end gap-2">

            {/* + button with expandable sub-actions */}
            <div className="relative flex-shrink-0" ref={plusRef}>
              {plusOpen && (
                <div className="absolute bottom-full left-0 mb-2 flex flex-col gap-2 z-30">
                  <button
                    onClick={openFilePicker}
                    className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold px-3 py-2 rounded-xl shadow-lg transition-all active:scale-95 whitespace-nowrap"
                  >
                    <Paperclip className="w-3.5 h-3.5" />
                    Send File
                  </button>
                  <button
                    onClick={openLinkMode}
                    className="flex items-center gap-2 bg-slate-700 hover:bg-slate-600 text-white text-xs font-semibold px-3 py-2 rounded-xl shadow-lg transition-all active:scale-95 whitespace-nowrap"
                  >
                    <Link2 className="w-3.5 h-3.5" />
                    Send Link
                  </button>
                </div>
              )}

              <button
                onClick={() => setPlusOpen(v => !v)}
                disabled={disabled}
                title="Attach file or send link"
                className={`w-10 h-10 rounded-xl border flex items-center justify-center transition-all active:scale-95 disabled:opacity-40 ${
                  plusOpen
                    ? 'bg-indigo-600 border-indigo-500 text-white rotate-45'
                    : 'bg-white/[0.05] hover:bg-white/[0.1] border-white/[0.08] text-slate-400 hover:text-slate-200'
                }`}
              >
                <Plus className="w-5 h-5 transition-transform duration-200" />
              </button>
            </div>

            {/* Text area */}
            <div className="flex-1 bg-white/[0.05] border border-white/[0.08] rounded-xl px-3 py-2.5 focus-within:border-indigo-500/50 focus-within:ring-1 focus-within:ring-indigo-500/20 transition-all min-w-0">
              <textarea
                ref={textareaRef}
                value={text}
                onChange={handleTextChange}
                onKeyDown={handleKeyDown}
                disabled={disabled}
                placeholder={disabled ? 'Connecting…' : 'Message… (Enter to send)'}
                rows={1}
                className="w-full bg-transparent text-white text-sm placeholder-slate-500 focus:outline-none resize-none leading-relaxed disabled:opacity-40"
                style={{ minHeight: '22px', maxHeight: '120px' }}
              />
            </div>

            {/*
             * ✅ Smart button: shows SEND when there's text, MIC when empty
             * This is the same pattern as WhatsApp/Telegram
             */}
            {text.trim() ? (
              /* Send text button */
              <button
                onClick={handleSendText}
                disabled={disabled}
                className="flex-shrink-0 w-10 h-10 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center text-white transition-all active:scale-95 shadow-lg shadow-indigo-500/20"
              >
                <Send className="w-4 h-4" />
              </button>
            ) : (
              /* Record voice button */
              <button
                onClick={startRecording}
                disabled={disabled}
                title="Record voice message"
                className="flex-shrink-0 w-10 h-10 rounded-xl bg-white/[0.05] hover:bg-red-500/20 border border-white/[0.08] hover:border-red-500/30 disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center text-slate-400 hover:text-red-400 transition-all active:scale-95"
              >
                <Mic className="w-4 h-4" />
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}