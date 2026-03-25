/**
 * useBroker — connection manager with server-first + MQTT fallback.
 */

import { useCallback, useRef, RefObject } from "react";
import mqtt, { MqttClient } from "mqtt";
import { BROKERS, CONNECT_TIMEOUT } from "./constants";
import { roomTopics } from "./helpers";
import type { PresencePayload } from "./types";
import { useServerBroker } from "./useServerBroker";

const RETRY_DELAY = 3_000;

interface Deps {
  myIdRef: RefObject<string>;
  clientRef: RefObject<MqttClient | null>;
  destroyedRef: RefObject<boolean>;
  addSystem: (text: string) => void;
  onMessage: (topic: string, payload: string) => void;
  onReconnected: () => Promise<void>;
  setOnline: (v: boolean) => void;
  onBinaryMessage?: (data: ArrayBuffer) => void;
}

export function useBroker(deps: Deps) {
  const { myIdRef, clientRef, destroyedRef } = deps;

  const addSystemRef = useRef(deps.addSystem);
  const onMessageRef = useRef(deps.onMessage);
  const onReconnectedRef = useRef(deps.onReconnected);
  const setOnlineRef = useRef(deps.setOnline);
  addSystemRef.current = deps.addSystem;
  onMessageRef.current = deps.onMessage;
  onReconnectedRef.current = deps.onReconnected;
  setOnlineRef.current = deps.setOnline;

  const attemptCountRef = useRef(0);

  const serverBroker = useServerBroker({
    myIdRef,
    destroyedRef,
    addSystem: deps.addSystem,
    onMessage: deps.onMessage,
    onReconnected: deps.onReconnected,
    setOnline: deps.setOnline,
    onBinaryMessage: deps.onBinaryMessage,
  });

  const modeRef = useRef<"server" | "mqtt" | null>(null);
  const serverCleanupRef = useRef<(() => void) | null>(null);

  const connectMqtt = useCallback(
    (code: string, name: string): Promise<void> => {
      modeRef.current = "mqtt";
      return new Promise((resolve) => {
        let initialDone = false;
        let retryTimer: ReturnType<typeof setTimeout> | null = null;
        const topics = roomTopics(code);

        const clearRetry = () => {
          if (retryTimer) {
            clearTimeout(retryTimer);
            retryTimer = null;
          }
        };
        const killClient = (c: MqttClient) => {
          c.removeAllListeners();
          try {
            c.end(true);
          } catch {
            /* */
          }
        };
        const scheduleNext = () => {
          if (destroyedRef.current) return;
          clearRetry();
          retryTimer = setTimeout(tryConnect, RETRY_DELAY);
        };

        const tryConnect = () => {
          if (destroyedRef.current) return;
          clearRetry();
          if (clientRef.current) {
            killClient(clientRef.current);
            clientRef.current = null;
          }

          attemptCountRef.current++;
          const attempt = attemptCountRef.current;
          const brokerUrl = BROKERS[(attempt - 1) % BROKERS.length];

          const lwtPayload: PresencePayload = {
            id: myIdRef.current,
            name,
            action: "leave",
          };
          const uniqueClientId = `tl_${myIdRef.current.replace(/-/g, "").slice(0, 12)}_${attempt}`;

          const client = mqtt.connect(brokerUrl, {
            clientId: uniqueClientId,
            clean: true,
            keepalive: 20,
            connectTimeout: CONNECT_TIMEOUT,
            reconnectPeriod: 0,
            will: {
              topic: topics.presence,
              payload: JSON.stringify({ v: 0, plain: lwtPayload }),
              qos: 1,
              retain: false,
            },
          });

          let dead = false;
          const hardTimeout = setTimeout(() => {
            if (dead) return;
            dead = true;
            killClient(client);
            if (clientRef.current === client) clientRef.current = null;
            scheduleNext();
          }, CONNECT_TIMEOUT + 1_000);

          const onDrop = (reason: string) => {
            if (dead) return;
            dead = true;
            clearTimeout(hardTimeout);
            const wasConnected = clientRef.current === client;
            killClient(client);
            if (wasConnected) {
              clientRef.current = null;
              setOnlineRef.current(false);
            }
            if (initialDone && wasConnected)
              addSystemRef.current("⚠️ Connection lost — reconnecting…");
            scheduleNext();
          };

          client.on("connect", () => {
            clearTimeout(hardTimeout);
            client.subscribe(
              [topics.chat, topics.presence, topics.call, topics.file],
              { qos: 1 },
              async (err) => {
                if (err) {
                  onDrop(`subscribe: ${err.message}`);
                  return;
                }
                clientRef.current = client;
                setOnlineRef.current(true);
                if (!initialDone) {
                  initialDone = true;
                  resolve();
                } else {
                  addSystemRef.current("✅ Reconnected");
                  try {
                    await onReconnectedRef.current();
                  } catch {
                    /* */
                  }
                }
              },
            );
          });
          client.on("message", (topic, payload) => {
            onMessageRef.current(topic, payload.toString());
          });
          client.on("error", (err) => onDrop(`error: ${err.message}`));
          client.on("close", () => onDrop("closed"));
          client.on("offline", () => onDrop("offline"));
        };

        tryConnect();
      });
    },
    [clientRef, destroyedRef, myIdRef],
  );

  const connect = useCallback(
    async (code: string, name: string, serverUrl?: string): Promise<void> => {
      if (serverUrl && serverUrl.trim()) {
        try {
          addSystemRef.current(`Connecting to server…`);
          const cleanup = await serverBroker.connect(serverUrl, code, name);
          serverCleanupRef.current = cleanup;
          modeRef.current = "server";
          return;
        } catch (err) {
          console.warn(`[TempLink] Server failed:`, err);
          addSystemRef.current(`⚠️ Server unreachable — using relay brokers`);
        }
      }
      await connectMqtt(code, name);
    },
    [connectMqtt, serverBroker],
  );

  const disconnectAll = useCallback(() => {
    if (serverCleanupRef.current) {
      serverCleanupRef.current();
      serverCleanupRef.current = null;
    }
    if (clientRef.current) {
      try {
        clientRef.current.end(true);
      } catch {
        /* */
      }
      clientRef.current = null;
    }
    modeRef.current = null;
  }, [clientRef]);

  return {
    connect,
    disconnectAll,
    modeRef,
    serverPublish: serverBroker.publish,
    serverGetWs: serverBroker.getWs,
  };
}
