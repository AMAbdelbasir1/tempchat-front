/**
 * useServerBroker — WebSocket relay transport.
 *
 * Now handles:
 *  - JSON messages (chat, presence, call signaling)
 *  - Binary frames (audio relay for voice calls)
 *  - Exposes getWs() so useCall can send binary directly
 */

import { useCallback, useRef, RefObject } from "react";
import { encryptPayload } from "../../utils/crypto";
import type { WireEnvelope, PresencePayload } from "./types";

const RETRY_DELAY = 3_000;
const CONNECT_TIMEOUT = 8_000;
const PING_INTERVAL = 25_000;

interface Deps {
  myIdRef: RefObject<string>;
  destroyedRef: RefObject<boolean>;
  addSystem: (text: string) => void;
  onMessage: (topic: string, payload: string) => void;
  onReconnected: () => Promise<void>;
  setOnline: (v: boolean) => void;
  onBinaryMessage?: (data: ArrayBuffer) => void;
}

export function useServerBroker(deps: Deps) {
  const { myIdRef, destroyedRef } = deps;

  const addSystemRef = useRef(deps.addSystem);
  const onMessageRef = useRef(deps.onMessage);
  const onReconnectedRef = useRef(deps.onReconnected);
  const setOnlineRef = useRef(deps.setOnline);
  const onBinaryRef = useRef(deps.onBinaryMessage);
  addSystemRef.current = deps.addSystem;
  onMessageRef.current = deps.onMessage;
  onReconnectedRef.current = deps.onReconnected;
  setOnlineRef.current = deps.setOnline;
  onBinaryRef.current = deps.onBinaryMessage;

  const wsRef = useRef<WebSocket | null>(null);
  const roomRef = useRef("");
  const nameRef = useRef("");
  const codeRef = useRef("");
  const attemptRef = useRef(0);
  const pingTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const normalizeUrl = (raw: string): string => {
    const url = raw.trim();
    if (url.startsWith("ws://") || url.startsWith("wss://")) return url;
    const isLocal = url.includes("localhost") || url.includes("127.0.0.1");
    return `${isLocal ? "ws" : "wss"}://${url}`;
  };

  /** Get the raw WebSocket — for binary audio sending */
  const getWs = useCallback((): WebSocket | null => {
    return wsRef.current;
  }, []);

  const publish = useCallback(
    async (topic: string, payload: unknown): Promise<void> => {
      const ws = wsRef.current;
      const code = codeRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN || !code) return;

      const enc: string = await encryptPayload(payload, code);
      const envelope: WireEnvelope = { v: 1, enc };
      const channel = topic.split("/").pop() ?? "chat";

      ws.send(
        JSON.stringify({
          type: "relay",
          channel,
          from: myIdRef.current,
          payload: envelope,
        }),
      );
    },
    [myIdRef],
  );

  const dispatch = useCallback(
    (msg: Record<string, unknown>) => {
      const room = roomRef.current;
      const prefix = `tmplink/v1/${room}`;
      const myId = myIdRef.current;

      if (msg.type === "relay") {
        const channel = (msg.channel as string) || "chat";
        onMessageRef.current(
          `${prefix}/${channel}`,
          JSON.stringify(msg.payload),
        );
        return;
      }

      if (msg.type === "peers") {
        ((msg.peers as { id: string; name: string }[]) ?? []).forEach((p) => {
          if (p.id === myId) return;
          onMessageRef.current(
            `${prefix}/presence`,
            JSON.stringify({
              v: 0,
              _source: "server",
              plain: {
                id: p.id,
                name: p.name,
                action: "join",
              } as PresencePayload,
            }),
          );
        });
        return;
      }

      if (msg.type === "join") {
        if ((msg.id as string) === myId) return;
        onMessageRef.current(
          `${prefix}/presence`,
          JSON.stringify({
            v: 0,
            _source: "server",
            plain: {
              id: msg.id,
              name: msg.name,
              action: "join",
            } as PresencePayload,
          }),
        );
        return;
      }

      if (msg.type === "leave") {
        if ((msg.id as string) === myId) return;
        onMessageRef.current(
          `${prefix}/presence`,
          JSON.stringify({
            v: 0,
            _source: "server",
            plain: {
              id: msg.id,
              name: msg.name,
              action: "leave",
            } as PresencePayload,
          }),
        );
        return;
      }
    },
    [myIdRef],
  );

  const stopPing = () => {
    if (pingTimer.current) {
      clearInterval(pingTimer.current);
      pingTimer.current = null;
    }
  };

  const connect = useCallback(
    (serverUrl: string, code: string, name: string): Promise<() => void> => {
      roomRef.current = code;
      nameRef.current = name;
      codeRef.current = code;

      return new Promise((resolve, reject) => {
        let initialDone = false;
        let retryTimer: ReturnType<typeof setTimeout> | null = null;
        let currentWs: WebSocket | null = null;
        let dead = false;

        const clearRetry = () => {
          if (retryTimer) {
            clearTimeout(retryTimer);
            retryTimer = null;
          }
        };

        const cleanup = () => {
          dead = true;
          clearRetry();
          stopPing();
          if (currentWs) {
            currentWs.onopen =
              currentWs.onmessage =
              currentWs.onclose =
              currentWs.onerror =
                null;
            try {
              currentWs.close();
            } catch {
              /* */
            }
            currentWs = null;
          }
          wsRef.current = null;
        };

        const scheduleRetry = () => {
          if (dead || destroyedRef.current) return;
          clearRetry();
          retryTimer = setTimeout(tryConnect, RETRY_DELAY);
        };

        const joinRoom = (ws: WebSocket) => {
          ws.send(
            JSON.stringify({
              type: "join",
              id: myIdRef.current,
              name: nameRef.current,
              room: roomRef.current,
            }),
          );
        };

        const startPing = (ws: WebSocket) => {
          stopPing();
          pingTimer.current = setInterval(() => {
            if (ws.readyState === WebSocket.OPEN)
              ws.send(JSON.stringify({ type: "ping" }));
          }, PING_INTERVAL);
        };

        const tryConnect = () => {
          if (dead || destroyedRef.current) return;
          clearRetry();
          if (currentWs) {
            currentWs.onopen =
              currentWs.onmessage =
              currentWs.onclose =
              currentWs.onerror =
                null;
            try {
              currentWs.close();
            } catch {
              /* */
            }
            currentWs = null;
          }
          wsRef.current = null;

          attemptRef.current++;
          const wsUrl = normalizeUrl(serverUrl);
          let socketDead = false;

          const hardTimeout = setTimeout(() => {
            if (socketDead) return;
            socketDead = true;
            try {
              currentWs?.close();
            } catch {
              /* */
            }
            currentWs = null;
            wsRef.current = null;
            if (!initialDone) {
              cleanup();
              reject(new Error("Timeout"));
            } else {
              setOnlineRef.current(false);
              scheduleRetry();
            }
          }, CONNECT_TIMEOUT);

          try {
            const ws = new WebSocket(wsUrl);
            ws.binaryType = "arraybuffer"; // ← IMPORTANT for audio relay
            currentWs = ws;

            ws.onopen = () => {
              if (socketDead) return;
              clearTimeout(hardTimeout);
              wsRef.current = ws;
              joinRoom(ws);
              startPing(ws);
              setOnlineRef.current(true);
              if (!initialDone) {
                initialDone = true;
                resolve(cleanup);
              } else {
                addSystemRef.current("✅ Reconnected to server");
                onReconnectedRef.current().catch(() => {});
              }
            };

            ws.onmessage = (event) => {
              if (socketDead) return;

              // Binary frame = audio relay data
              if (event.data instanceof ArrayBuffer) {
                onBinaryRef.current?.(event.data);
                return;
              }

              // JSON frame = existing protocol
              try {
                dispatch(JSON.parse(event.data as string));
              } catch (err) {
                console.error("[ServerBroker] Parse error:", err);
              }
            };

            ws.onerror = () => {
              if (socketDead) return;
              socketDead = true;
              clearTimeout(hardTimeout);
              stopPing();
              wsRef.current = null;
              currentWs = null;
              if (!initialDone) {
                cleanup();
                reject(new Error("Connection error"));
              } else {
                setOnlineRef.current(false);
                addSystemRef.current("⚠️ Connection lost — reconnecting…");
                scheduleRetry();
              }
            };

            ws.onclose = () => {
              if (socketDead) return;
              socketDead = true;
              clearTimeout(hardTimeout);
              stopPing();
              wsRef.current = null;
              currentWs = null;
              if (!initialDone) {
                cleanup();
                reject(new Error("Connection closed"));
              } else {
                setOnlineRef.current(false);
                addSystemRef.current("⚠️ Connection lost — reconnecting…");
                scheduleRetry();
              }
            };
          } catch (err) {
            clearTimeout(hardTimeout);
            if (!initialDone) reject(err);
            else scheduleRetry();
          }
        };

        tryConnect();
      });
    },
    [myIdRef, destroyedRef, dispatch],
  );

  return { connect, publish, getWs };
}
