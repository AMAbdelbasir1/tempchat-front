/**
 * useSenders — all outgoing message actions.
 *
 * NEW: editMessage() and deleteMessage() for message management.
 */

import { useCallback, RefObject } from "react";
import { v4 as uuidv4 } from "uuid";
import {
  CHUNK_SIZE,
  CHUNK_DELAY,
  SERVER_CHUNK_SIZE,
  SERVER_CHUNK_DELAY,
} from "./constants";
import { roomTopics, formatBytes } from "./helpers";
import type { ChatPayload, FileChunkPayload } from "./types";
import type { Message } from "../../types";

interface Deps {
  myIdRef: RefObject<string>;
  myNameRef: RefObject<string>;
  roomCodeRef: RefObject<string>;
  addMsg: (msg: Message) => void;
  updateMsg: (id: string, updates: Partial<Message>) => void;
  removeMsg: (id: string) => void;
  publish: (topic: string, payload: unknown) => Promise<void>;
  getMode: () => "server" | "mqtt" | null;
}

export function useSenders(deps: Deps) {
  const {
    myIdRef,
    myNameRef,
    roomCodeRef,
    addMsg,
    updateMsg,
    removeMsg,
    publish,
    getMode,
  } = deps;

  /* ── Text message ─────────────────────────────────── */
  const sendMessage = useCallback(
    async (text: string) => {
      if (!text.trim()) return;
      const msg: Message = {
        id: uuidv4(),
        type: "text",
        content: text.trim(),
        sender: "me",
        senderName: myNameRef.current,
        timestamp: Date.now(),
      };
      addMsg(msg);
      const payload: ChatPayload = {
        id: msg.id,
        from: myIdRef.current,
        fromName: myNameRef.current,
        msgType: "text",
        content: msg.content,
        timestamp: msg.timestamp,
      };
      await publish(roomTopics(roomCodeRef.current).chat, payload);
    },
    [addMsg, publish, myIdRef, myNameRef, roomCodeRef],
  );

  /* ── Link ─────────────────────────────────────────── */
  const sendLink = useCallback(
    async (url: string) => {
      if (!url.trim()) return;
      const msg: Message = {
        id: uuidv4(),
        type: "link",
        content: url.trim(),
        sender: "me",
        senderName: myNameRef.current,
        timestamp: Date.now(),
      };
      addMsg(msg);
      const payload: ChatPayload = {
        id: msg.id,
        from: myIdRef.current,
        fromName: myNameRef.current,
        msgType: "link",
        content: msg.content,
        timestamp: msg.timestamp,
      };
      await publish(roomTopics(roomCodeRef.current).chat, payload);
    },
    [addMsg, publish, myIdRef, myNameRef, roomCodeRef],
  );

  /* ── Edit message ─────────────────────────────────── */
  const editMessage = useCallback(
    async (msgId: string, newContent: string) => {
      if (!newContent.trim()) return;

      // Update locally
      updateMsg(msgId, { content: newContent.trim(), edited: true });

      // Broadcast edit to peers
      const payload: ChatPayload = {
        id: uuidv4(),
        from: myIdRef.current,
        fromName: myNameRef.current,
        msgType: "edit",
        content: newContent.trim(),
        timestamp: Date.now(),
        editMsgId: msgId,
      };
      await publish(roomTopics(roomCodeRef.current).chat, payload);
    },
    [updateMsg, publish, myIdRef, myNameRef, roomCodeRef],
  );

  /* ── Delete message ───────────────────────────────── */
  const deleteMessage = useCallback(
    async (msgId: string, isMine: boolean) => {
      // Remove locally
      removeMsg(msgId);

      // Only broadcast if it's my message
      if (isMine) {
        const payload: ChatPayload = {
          id: uuidv4(),
          from: myIdRef.current,
          fromName: myNameRef.current,
          msgType: "delete",
          content: msgId, // the ID of the message to delete
          timestamp: Date.now(),
        };
        await publish(roomTopics(roomCodeRef.current).chat, payload);
      }
    },
    [removeMsg, publish, myIdRef, myNameRef, roomCodeRef],
  );

  /* ── File (mode-aware chunked transfer) ─────────── */
  const sendFile = useCallback(
    (file: File) => {
      const reader = new FileReader();

      reader.onload = async (e) => {
        const dataUrl = e.target?.result as string;
        const base64 = dataUrl.split(",")[1];
        const txId = uuidv4();
        const msgId = uuidv4();
        const topic = roomTopics(roomCodeRef.current).file;

        const isServer = getMode() === "server";
        const chunkSize = isServer ? SERVER_CHUNK_SIZE : CHUNK_SIZE;
        const chunkDelay = isServer ? SERVER_CHUNK_DELAY : CHUNK_DELAY;
        const total = Math.ceil(base64.length / chunkSize);

        console.log(
          `[sendFile] ${file.name} (${formatBytes(file.size)}) → ` +
            `${total} chunks × ${formatBytes(chunkSize)} via ${isServer ? "server" : "relay"} ` +
            `(delay: ${chunkDelay}ms)`,
        );

        addMsg({
          id: msgId,
          type: "file",
          content: `📎 ${file.name} (${formatBytes(file.size)})`,
          sender: "me",
          senderName: myNameRef.current,
          timestamp: Date.now(),
          progress: 0,
          file: {
            id: txId,
            name: file.name,
            size: file.size,
            type: file.type,
            url: dataUrl,
          },
        });

        let failedChunk = -1;
        const startTime = Date.now();

        for (let i = 0; i < total; i++) {
          try {
            const chunkPayload: FileChunkPayload = {
              txId,
              from: myIdRef.current,
              fromName: myNameRef.current,
              chunkIndex: i,
              totalChunks: total,
              fileName: file.name,
              fileType: file.type,
              fileSize: file.size,
              data: base64.slice(i * chunkSize, (i + 1) * chunkSize),
            };

            await publish(topic, chunkPayload);

            const pct = Math.round(((i + 1) / total) * 100);
            const elapsed = (Date.now() - startTime) / 1000;
            const bytesTransferred =
              Math.min((i + 1) * chunkSize, base64.length) * 0.75;
            const speed = elapsed > 0 ? bytesTransferred / elapsed : 0;

            if (pct >= 100) {
              updateMsg(msgId, { progress: undefined });
            } else {
              updateMsg(msgId, {
                progress: pct,
                content: `📎 ${file.name} (${formatBytes(file.size)}) · ${formatBytes(Math.round(speed))}/s`,
              });
            }

            if (chunkDelay > 0 && i < total - 1) {
              await new Promise((r) => setTimeout(r, chunkDelay));
            } else if (i < total - 1 && i % 10 === 9) {
              await new Promise((r) => setTimeout(r, 0));
            }
          } catch (err) {
            console.error(`[sendFile] chunk ${i} failed:`, err);
            failedChunk = i;
            break;
          }
        }

        if (failedChunk >= 0) {
          updateMsg(msgId, {
            progress: undefined,
            content: `📎 ${file.name} — Failed at chunk ${failedChunk + 1}/${total}`,
          });
        } else {
          updateMsg(msgId, {
            progress: undefined,
            content: `📎 ${file.name} (${formatBytes(file.size)})`,
          });
        }
      };

      reader.onerror = () => {
        addMsg({
          id: uuidv4(),
          type: "system",
          content: `❌ Failed to read file: ${file.name}`,
          sender: "peer",
          senderName: "System",
          timestamp: Date.now(),
        });
      };

      reader.readAsDataURL(file);
    },
    [addMsg, updateMsg, publish, myIdRef, myNameRef, roomCodeRef, getMode],
  );

  return { sendMessage, sendLink, sendFile, editMessage, deleteMessage };
}
