import { Download, ExternalLink, FileText, Image, Film, Music, Archive, Lock, Loader2, Mic } from 'lucide-react';
import { Message } from '../types';

interface Props {
  msg: Message;
}

function getFileIcon(type: string) {
  if (type.startsWith('image/'))  return <Image className="w-4 h-4" />;
  if (type.startsWith('video/'))  return <Film className="w-4 h-4" />;
  if (type.startsWith('audio/'))  return <Music className="w-4 h-4" />;
  if (type.includes('zip') || type.includes('rar') || type.includes('tar')) return <Archive className="w-4 h-4" />;
  return <FileText className="w-4 h-4" />;
}

/** Check if this is a voice recording (audio file with "Voice" in name) */
function isVoiceMessage(msg: Message): boolean {
  if (msg.type !== 'file' || !msg.file) return false;
  return (
    msg.file.type.startsWith('audio/') &&
    msg.file.name.toLowerCase().startsWith('voice')
  );
}

function isValidUrl(str: string) {
  try { new URL(str); return true; } catch { return false; }
}

function formatTime(ts: number) {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function MessageBubble({ msg }: Props) {
  if (msg.type === 'system') {
    return (
      <div className="flex justify-center my-2">
        <span className="text-xs text-slate-500 bg-white/[0.04] px-3 py-1 rounded-full border border-white/[0.06]">
          {msg.content}
        </span>
      </div>
    );
  }

  const isMe       = msg.sender === 'me';
  const isLoading  = msg.progress !== undefined && msg.progress >= 0;
  const isFailed   = msg.content.includes('Failed');
  const isVoice    = isVoiceMessage(msg);

  return (
    <div className={`flex gap-2 mb-3 ${isMe ? 'flex-row-reverse' : 'flex-row'}`}>
      {/* Avatar */}
      <div className={`w-7 h-7 rounded-full flex-shrink-0 flex items-center justify-center text-xs font-bold ${
        isMe ? 'bg-indigo-600 text-white' : 'bg-slate-700 text-slate-300'
      }`}>
        {msg.senderName.charAt(0).toUpperCase()}
      </div>

      <div className={`max-w-[75%] flex flex-col ${isMe ? 'items-end' : 'items-start'}`}>
        {/* Name */}
        <span className="text-[11px] text-slate-500 mb-0.5 px-1">{msg.senderName}</span>

        {/* ── Voice message bubble ── */}
        {msg.type === 'file' && isVoice ? (
          <div className={`rounded-2xl overflow-hidden border w-full min-w-[220px] max-w-[300px] ${
            isMe
              ? 'bg-indigo-600/20 border-indigo-500/30'
              : 'bg-white/[0.05] border-white/[0.08]'
          }`}>
            <div className="flex items-center gap-3 px-3 pt-3 pb-1">
              <div className={`w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 ${
                isMe ? 'bg-indigo-500/30 text-indigo-300' : 'bg-white/[0.08] text-slate-300'
              }`}>
                {isLoading
                  ? <Loader2 className="w-4 h-4 animate-spin" />
                  : <Mic className="w-4 h-4" />
                }
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-xs font-medium text-slate-300">
                  🎙️ Voice message
                </div>
                {isLoading ? (
                  <div className="text-xs text-indigo-300 font-medium">
                    {isMe ? `Sending… ${msg.progress}%` : `Receiving… ${msg.progress}%`}
                  </div>
                ) : (
                  <div className="text-xs text-slate-500">
                    {formatBytes(msg.file?.size ?? 0)}
                  </div>
                )}
              </div>
            </div>

            {/* Audio player — only when complete */}
            {!isLoading && !isFailed && msg.file?.url && (
              <div className="px-3 pb-3 pt-1">
                <audio
                  src={msg.file.url}
                  controls
                  preload="metadata"
                  controlsList="nodownload"
                  className="w-full h-8 opacity-90"
                  style={{
                    /* Style the audio player to match dark theme */
                    filter: 'invert(1) hue-rotate(180deg)',
                    borderRadius: '8px',
                  }}
                />
              </div>
            )}

            {/* Progress bar */}
            {isLoading && (
              <div className="px-3 pb-3">
                <div className="w-full h-1.5 bg-black/30 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-indigo-500 rounded-full transition-all duration-300 ease-out"
                    style={{ width: `${msg.progress ?? 0}%` }}
                  />
                </div>
              </div>
            )}
          </div>

        ) : msg.type === 'file' ? (
          /* ── Regular file bubble ── */
          <div className={`rounded-2xl overflow-hidden border w-full min-w-[200px] ${
            isMe
              ? 'bg-indigo-600/20 border-indigo-500/30'
              : 'bg-white/[0.05] border-white/[0.08]'
          }`}>
            {/* Image preview */}
            {msg.file?.type.startsWith('image/') && !isLoading && msg.file?.url && (
              <img
                src={msg.file.url}
                alt={msg.file.name}
                className="max-w-xs max-h-64 object-cover cursor-pointer hover:opacity-90 transition-opacity"
                onClick={() => window.open(msg.file!.url, '_blank')}
              />
            )}
            {/* Video preview */}
            {msg.file?.type.startsWith('video/') && !isLoading && msg.file?.url && (
              <video
                src={msg.file.url}
                controls
                className="max-w-xs max-h-48"
              />
            )}
            {/* Audio preview (non-voice audio files like .mp3) */}
            {msg.file?.type.startsWith('audio/') && !isVoice && !isLoading && msg.file?.url && (
              <div className="px-3 pt-2">
                <audio
                  src={msg.file.url}
                  controls
                  preload="metadata"
                  className="w-full h-8"
                  style={{
                    filter: 'invert(1) hue-rotate(180deg)',
                    borderRadius: '8px',
                  }}
                />
              </div>
            )}
            {/* File info row */}
            <div className="flex items-center gap-3 p-3">
              <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${
                isMe ? 'bg-indigo-500/30 text-indigo-300' : 'bg-white/[0.08] text-slate-300'
              }`}>
                {isLoading
                  ? <Loader2 className="w-4 h-4 animate-spin" />
                  : getFileIcon(msg.file?.type ?? '')
                }
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-white truncate">
                  {msg.file?.name ?? 'File'}
                </div>
                {isLoading ? (
                  <div className="text-xs text-indigo-300 font-medium">
                    {isMe ? `Sending… ${msg.progress}%` : `Receiving… ${msg.progress}%`}
                  </div>
                ) : isFailed ? (
                  <div className="text-xs text-red-400 font-medium">
                    Failed to send
                  </div>
                ) : (
                  <div className="text-xs text-slate-400">
                    {formatBytes(msg.file?.size ?? 0)}
                  </div>
                )}
              </div>
              {/* Download button */}
              {!isLoading && !isFailed && msg.file?.url && (
                <a
                  href={msg.file.url}
                  download={msg.file.name}
                  className={`w-8 h-8 rounded-lg flex items-center justify-center transition-colors flex-shrink-0 ${
                    isMe
                      ? 'bg-indigo-500/30 hover:bg-indigo-500/50 text-indigo-300'
                      : 'bg-white/[0.08] hover:bg-white/[0.15] text-slate-300'
                  }`}
                >
                  <Download className="w-4 h-4" />
                </a>
              )}
            </div>

            {/* Progress bar */}
            {isLoading && (
              <div className="px-3 pb-3">
                <div className="w-full h-1.5 bg-black/30 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-indigo-500 rounded-full transition-all duration-300 ease-out"
                    style={{ width: `${msg.progress ?? 0}%` }}
                  />
                </div>
              </div>
            )}
          </div>

        ) : msg.type === 'link' && isValidUrl(msg.content) ? (
          /* ── Link bubble ── */
          <div className={`rounded-2xl p-3 border ${
            isMe
              ? 'bg-indigo-600/20 border-indigo-500/30'
              : 'bg-white/[0.05] border-white/[0.08]'
          }`}>
            <div className="flex items-center gap-2">
              <ExternalLink className="w-4 h-4 text-indigo-400 flex-shrink-0" />
              <a
                href={msg.content}
                target="_blank"
                rel="noopener noreferrer"
                className="text-indigo-400 hover:text-indigo-300 text-sm break-all underline underline-offset-2"
              >
                {msg.content}
              </a>
            </div>
          </div>
        ) : (
          /* ── Text bubble ── */
          <div className={`rounded-2xl px-4 py-2.5 ${
            isMe
              ? 'bg-indigo-600 text-white rounded-br-sm'
              : 'bg-white/[0.07] text-slate-100 border border-white/[0.08] rounded-bl-sm'
          }`}>
            <p className="text-sm leading-relaxed whitespace-pre-wrap break-words">{msg.content}</p>
          </div>
        )}

        {/* Timestamp + lock */}
        <div className="flex items-center gap-1 mt-0.5 px-1">
          <Lock className="w-2.5 h-2.5 text-slate-700" />
          <span className="text-[10px] text-slate-600">{formatTime(msg.timestamp)}</span>
        </div>
      </div>
    </div>
  );
}