/**
 * useMessageHandler — decrypts and routes every incoming message.
 *
 * NEW: Handles 'edit' and 'delete' message types from peers.
 */

import { useCallback, useRef, RefObject } from "react";
import { decryptPayload } from "../../utils/crypto";
import { roomTopics, formatBytes } from "./helpers";
import type {
  WireEnvelope,
  PresencePayload,
  ChatPayload,
  FileChunkPayload,
  ChunkBuffer,
  PeerEntry,
} from "./types";
import type { Message, FileAttachment } from "../../types";
import { v4 as uuidv4 } from "uuid";

const LWT_GRACE_PERIOD = 10_000;

interface Deps {
  roomCodeRef: RefObject<string>;
  myIdRef: RefObject<string>;
  myNameRef: RefObject<string>;
  peersRef: RefObject<Map<string, PeerEntry>>;
  chunkBuffers: RefObject<Map<string, ChunkBuffer>>;
  addMsg: (msg: Message) => void;
  updateMsg: (id: string, updates: Partial<Message>) => void;
  removeMsg: (id: string) => void;
  addSystem: (text: string) => void;
  publish: (topic: string, payload: unknown) => Promise<void>;
  updatePeerSeen: (id: string, name: string) => void;
  removePeer: (id: string) => string;
  onCallSignal?: (signal: unknown) => Promise<void>;
}

const txMsgMap = new Map<string, string>();

export function useMessageHandler(deps: Deps) {
  const {
    roomCodeRef,
    myIdRef,
    myNameRef,
    peersRef,
    chunkBuffers,
    addMsg,
    updateMsg,
    removeMsg,
    addSystem,
    publish,
    updatePeerSeen,
    removePeer,
    onCallSignal,
  } = deps;

  const lastEncryptedSeen = useRef<Map<string, number>>(new Map());

  /* ── Presence ────────────────────────────────────────────── */
  const handlePresence = useCallback(
    async (p: PresencePayload) => {
      if (p.id === myIdRef.current) return;
      const topics = roomTopics(roomCodeRef.current);
      const isKnown = peersRef.current.has(p.id);

      if (p.action === "join") {
        lastEncryptedSeen.current.set(p.id, Date.now());
        updatePeerSeen(p.id, p.name);
        if (!isKnown) addSystem(`🟢 ${p.name} joined the room`);
        const pong: PresencePayload = {
          id: myIdRef.current,
          name: myNameRef.current,
          action: "ping",
        };
        await publish(topics.presence, pong);
        return;
      }

      if (p.action === "ping" || p.action === "heartbeat") {
        lastEncryptedSeen.current.set(p.id, Date.now());
        if (!isKnown) addSystem(`🟢 ${p.name} joined the room`);
        updatePeerSeen(p.id, p.name);
        return;
      }

      if (p.action === "leave") {
        if (!isKnown) return;
        const name = removePeer(p.id);
        lastEncryptedSeen.current.delete(p.id);
        addSystem(`🔴 ${name} left the room`);
      }
    },
    [
      addSystem,
      publish,
      updatePeerSeen,
      removePeer,
      myIdRef,
      myNameRef,
      roomCodeRef,
      peersRef,
    ],
  );

  /* ── Chat message (text, link, edit, delete) ─────────────── */
  const handleChat = useCallback(
    (c: ChatPayload) => {
      // Ignore own messages
      if (c.from === myIdRef.current) return;

      // ✅ FIX: 'edit' — update existing message, then STOP
      if (c.msgType === "edit") {
        if (c.editMsgId) {
          updateMsg(c.editMsgId, {
            content: c.content,
            edited: true,
          });
        }
        return; // ← was missing — caused fall-through to addMsg
      }

      // ✅ FIX: 'delete' — remove message by id, then STOP
      // c.content holds the target message id (the UUID)
      if (c.msgType === "delete") {
        removeMsg(c.content);
        return; // ← was missing — caused the UUID to be added as a new message
      }

      // Normal text / link message
      addMsg({
        id: c.id,
        type: c.msgType as Message["type"],
        content: c.content,
        sender: "peer",
        senderName: c.fromName,
        timestamp: c.timestamp,
      });
    },
    [addMsg, updateMsg, removeMsg, myIdRef],
  );

  /* ── File chunk ──────────────────────────────────────────── */
  const handleFileChunk = useCallback(
    (fc: FileChunkPayload) => {
      if (fc.from === myIdRef.current) return;

      if (!chunkBuffers.current.has(fc.txId)) {
        chunkBuffers.current.set(fc.txId, {
          fileName: fc.fileName,
          fileType: fc.fileType,
          fileSize: fc.fileSize,
          totalChunks: fc.totalChunks,
          fromName: fc.fromName,
          received: new Map(),
        });
        const placeholderMsgId = uuidv4();
        txMsgMap.set(fc.txId, placeholderMsgId);
        addMsg({
          id: placeholderMsgId,
          type: "file",
          content: `📎 ${fc.fileName} (${formatBytes(fc.fileSize)})`,
          sender: "peer",
          senderName: fc.fromName,
          timestamp: Date.now(),
          progress: 0,
        });
      }

      const buf = chunkBuffers.current.get(fc.txId)!;
      buf.received.set(fc.chunkIndex, fc.data);
      const pct = Math.round((buf.received.size / buf.totalChunks) * 100);
      const msgId = txMsgMap.get(fc.txId);

      if (buf.received.size < buf.totalChunks) {
        if (msgId) updateMsg(msgId, { progress: pct });
        return;
      }

      const parts: string[] = [];
      for (let i = 0; i < buf.totalChunks; i++) {
        parts.push(buf.received.get(i) ?? "");
      }

      const url = `data:${buf.fileType};base64,${parts.join("")}`;
      const attachment: FileAttachment = {
        id: fc.txId,
        name: buf.fileName,
        size: buf.fileSize,
        type: buf.fileType,
        url,
      };

      if (msgId) {
        updateMsg(msgId, {
          progress: undefined,
          content: `📎 ${buf.fileName} (${formatBytes(buf.fileSize)})`,
          file: attachment,
        });
        txMsgMap.delete(fc.txId);
      } else {
        addMsg({
          id: uuidv4(),
          type: "file",
          content: `📎 ${buf.fileName} (${formatBytes(buf.fileSize)})`,
          sender: "peer",
          senderName: buf.fromName,
          timestamp: Date.now(),
          file: attachment,
        });
      }
      chunkBuffers.current.delete(fc.txId);
    },
    [addMsg, updateMsg, myIdRef, chunkBuffers],
  );

  /* ── Plain leave handler ─────────────────────────────────── */
  const handlePlainLeave = useCallback(
    (plain: PresencePayload, source: "lwt" | "server") => {
      if (plain.id === myIdRef.current) return;
      if (!peersRef.current.has(plain.id)) return;

      if (source === "lwt") {
        const lastSeen = lastEncryptedSeen.current.get(plain.id);
        if (lastSeen && Date.now() - lastSeen < LWT_GRACE_PERIOD) return;
      }

      const name = removePeer(plain.id);
      lastEncryptedSeen.current.delete(plain.id);
      addSystem(
        `🔴 ${name} ${source === "server" ? "left the room" : "disconnected"}`,
      );
    },
    [addSystem, removePeer, myIdRef, peersRef],
  );

  /* ── Main router ─────────────────────────────────────────── */
  const handleMessage = useCallback(
    async (topic: string, raw: string) => {
      const code = roomCodeRef.current;
      const topics = roomTopics(code);

      let envelope: WireEnvelope & { _source?: string };
      try {
        envelope = JSON.parse(raw);
      } catch {
        return;
      }

      if (
        envelope.v === 0 &&
        (envelope as unknown as { plain: PresencePayload }).plain
      ) {
        const plain = (envelope as unknown as { plain: PresencePayload }).plain;
        const source = (envelope as unknown as { _source?: string })._source;

        if (topic === topics.presence) {
          if (plain.action === "leave") {
            handlePlainLeave(plain, source === "server" ? "server" : "lwt");
          } else if (
            plain.action === "join" ||
            plain.action === "ping" ||
            plain.action === "heartbeat"
          ) {
            await handlePresence(plain);
          }
        }
        return;
      }

      if (!envelope.enc) return;

      let data: Record<string, unknown>;
      try {
        data = await decryptPayload<Record<string, unknown>>(
          envelope.enc,
          code,
        );
      } catch {
        return;
      }

      if (topic === topics.presence) {
        await handlePresence(data as unknown as PresencePayload);
      } else if (topic === topics.chat) {
        handleChat(data as unknown as ChatPayload);
      } else if (topic === topics.call) {
        if (onCallSignal) await onCallSignal(data);
      } else if (topic === topics.file) {
        handleFileChunk(data as unknown as FileChunkPayload);
      }
    },
    [
      handlePresence,
      handleChat,
      handleFileChunk,
      handlePlainLeave,
      onCallSignal,
      roomCodeRef,
    ],
  );

  return handleMessage;
}
