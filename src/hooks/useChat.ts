/**
 * useChat — thin orchestrator.
 *
 * FIX: Passes connection mode to useSenders for mode-aware file transfer.
 * Server mode: fast 128KB chunks, no delay
 * MQTT mode: safe 8KB chunks, 200ms delay
 */

import { useState, useCallback, useRef, useEffect } from "react";
import { v4 as uuidv4 } from "uuid";
import { MqttClient } from "mqtt";
import { encryptPayload, keyFingerprint } from "../utils/crypto";
import type { Message, Room, ConnectionStatus } from "../types";
import type {
  ChunkBuffer,
  PresencePayload,
  WireEnvelope,
  PeerEntry,
} from "./chat/types";
import type { SignalPayload } from "./call/types";

import { generateCode, roomTopics, roomLink } from "./chat/helpers";
import { HEARTBEAT_INTERVAL, PEER_TIMEOUT } from "./chat/constants";
import { useBroker } from "./chat/useBroker";
import { usePublish } from "./chat/usePublish";
import { useMessageHandler } from "./chat/useMessageHandler";
import { useSenders } from "./chat/useSenders";
import { useCall } from "./useCall";

export function useChat() {
  /* ── Public state ────────────────────────────────────────── */
  const [status, setStatus] = useState<ConnectionStatus>("idle");
  const [room, setRoom] = useState<Room | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [peerCount, setPeerCount] = useState(0);
  const [peerList, setPeerList] = useState<{ id: string; name: string }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [fingerprint, setFingerprint] = useState("");
  const [isOnline, setIsOnline] = useState(true);
  const [mode, setMode] = useState<"server" | "mqtt">("mqtt");

  /* ── Stable refs ─────────────────────────────────────────── */
  const myIdRef = useRef(uuidv4());
  const myNameRef = useRef("");
  const myCodeRef = useRef("");
  const clientRef = useRef<MqttClient | null>(null);
  const destroyed = useRef(false);

  const peers = useRef<Map<string, PeerEntry>>(new Map());
  const chunks = useRef<Map<string, ChunkBuffer>>(new Map());

  const heartbeatTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const peerWatchTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const isOnlineRef = useRef(true);

  const handleBinaryRef = useRef<((data: ArrayBuffer) => void) | null>(null);

  /* ── Helpers ─────────────────────────────────────────────── */
  const addMsg = useCallback(
    (msg: Message) => setMessages((prev) => [...prev, msg]),
    [],
  );
  const updateMsg = useCallback(
    (id: string, updates: Partial<Message>) =>
      setMessages((prev) =>
        prev.map((m) => (m.id === id ? ({ ...m, ...updates } as Message) : m)),
      ),
    [],
  );
  const addSystem = useCallback(
    (text: string) =>
      addMsg({
        id: uuidv4(),
        type: "system",
        content: text,
        sender: "peer",
        senderName: "System",
        timestamp: Date.now(),
      }),
    [addMsg],
  );
  const syncPeers = useCallback(() => {
    setPeerCount(peers.current.size);
    setPeerList(
      Array.from(peers.current.entries()).map(([id, e]) => ({
        id,
        name: e.name,
      })),
    );
  }, []);

  /* ── Peer management ─────────────────────────────────────── */
  const updatePeerSeen = useCallback(
    (id: string, name: string) => {
      const entry = peers.current.get(id);
      if (entry) entry.lastSeen = Date.now();
      else peers.current.set(id, { name, lastSeen: Date.now() });
      syncPeers();
    },
    [syncPeers],
  );

  const removePeer = useCallback(
    (id: string): string => {
      const name = peers.current.get(id)?.name ?? "Someone";
      peers.current.delete(id);
      syncPeers();
      return name;
    },
    [syncPeers],
  );

  /* ── Timers ──────────────────────────────────────────────── */
  const stopTimers = useCallback(() => {
    if (heartbeatTimer.current) {
      clearInterval(heartbeatTimer.current);
      heartbeatTimer.current = null;
    }
    if (peerWatchTimer.current) {
      clearInterval(peerWatchTimer.current);
      peerWatchTimer.current = null;
    }
  }, []);

  /* ── Publish (MQTT mode) ─────────────────────────────────── */
  const mqttPublish = usePublish(clientRef, myCodeRef);

  /* ── Broker (server + MQTT) ──────────────────────────────── */
  const {
    connect: brokerConnect,
    disconnectAll: brokerDisconnectAll,
    modeRef,
    serverPublish,
    serverGetWs,
  } = useBroker({
    myIdRef,
    clientRef,
    destroyedRef: destroyed,
    addSystem,
    onMessage: (topic: string, payload: string) =>
      handleMessage(topic, payload),
    onReconnected: async () => {
      peers.current.forEach((entry) => {
        entry.lastSeen = Date.now();
      });
      await announcePresence();
    },
    setOnline: (online: boolean) => {
      isOnlineRef.current = online;
      setIsOnline(online);
      if (online)
        peers.current.forEach((entry) => {
          entry.lastSeen = Date.now();
        });
    },
    onBinaryMessage: (data: ArrayBuffer) => {
      handleBinaryRef.current?.(data);
    },
  });

  /* ── Smart publish ───────────────────────────────────────── */
  const publish = useCallback(
    async (topic: string, payload: unknown): Promise<void> => {
      if (modeRef.current === "server") return serverPublish(topic, payload);
      return mqttPublish(topic, payload);
    },
    [modeRef, serverPublish, mqttPublish],
  );

  /* ── Call signaling sender ───────────────────────────────── */
  const sendCallSignal = useCallback(
    (payload: SignalPayload) => {
      const code = myCodeRef.current;
      if (!code) return;

      if (modeRef.current === "server") {
        serverPublish(roomTopics(code).call, payload).catch(() => {});
        return;
      }

      const client = clientRef.current;
      if (!client?.connected) return;
      encryptPayload(payload, code)
        .then((enc) => {
          const envelope: WireEnvelope = { v: 1, enc };
          client.publish(roomTopics(code).call, JSON.stringify(envelope), {
            qos: 1,
          });
        })
        .catch((err) => console.error("[useChat] Call signal error:", err));
    },
    [modeRef, serverPublish],
  );

  /* ── useCall — WebRTC + WS relay fallback ────────────────── */
  const {
    activeCall,
    localStream,
    remoteStream,
    isAudioMuted,
    isVideoMuted,
    callError,
    startCall,
    acceptCall,
    rejectCall,
    hangup,
    toggleAudio,
    toggleVideo,
    handleCallSignal,
    handleBinaryMessage,
  } = useCall({
    myId: () => myIdRef.current,
    myName: () => myNameRef.current,
    sendSignal: sendCallSignal,
    getMode: () => modeRef.current,
    getWs: () => serverGetWs(),
  });

  handleBinaryRef.current = handleBinaryMessage;

  /* ── Message handler ─────────────────────────────────────── */
  const handleMessage = useMessageHandler({
    roomCodeRef: myCodeRef,
    myIdRef,
    myNameRef,
    peersRef: peers,
    chunkBuffers: chunks,
    addMsg,
    updateMsg,
    addSystem,
    publish,
    updatePeerSeen,
    removePeer,
    onCallSignal: handleCallSignal as (s: unknown) => Promise<void>,
  });

  /* ── Announce presence ──────────────────────────────────── */
  const announcePresence = useCallback(async () => {
    const code = myCodeRef.current;
    const name = myNameRef.current;
    if (!code || !name) return;
    const joinMsg: PresencePayload = {
      id: myIdRef.current,
      name,
      action: "join",
    };

    if (modeRef.current === "server") {
      try {
        await publish(roomTopics(code).presence, joinMsg);
      } catch {
        /* */
      }
      return;
    }

    for (let i = 0; i < 5; i++) {
      if (destroyed.current) return;
      try {
        await publish(roomTopics(code).presence, joinMsg);
      } catch {
        /* */
      }
      if (i < 4) await new Promise((r) => setTimeout(r, 800));
    }
  }, [publish, modeRef]);

  /* ── Heartbeat + peer watcher ────────────────────────────── */
  const startTimers = useCallback(() => {
    if (heartbeatTimer.current) clearInterval(heartbeatTimer.current);
    if (peerWatchTimer.current) clearInterval(peerWatchTimer.current);

    heartbeatTimer.current = setInterval(async () => {
      if (destroyed.current || !isOnlineRef.current) return;
      const hb: PresencePayload = {
        id: myIdRef.current,
        name: myNameRef.current,
        action: "heartbeat",
      };
      try {
        await publish(roomTopics(myCodeRef.current).presence, hb);
      } catch {
        /* */
      }
    }, HEARTBEAT_INTERVAL);

    peerWatchTimer.current = setInterval(() => {
      if (!isOnlineRef.current) return;
      if (modeRef.current === "server") return;
      const now = Date.now();
      let changed = false;
      peers.current.forEach((entry, id) => {
        if (now - entry.lastSeen > PEER_TIMEOUT) {
          addSystem(`🔴 ${entry.name} disconnected`);
          peers.current.delete(id);
          changed = true;
        }
      });
      if (changed) syncPeers();
    }, HEARTBEAT_INTERVAL);
  }, [addSystem, publish, syncPeers, modeRef]);

  /* ── Senders (✅ FIX: pass getMode for mode-aware file transfer) ─── */
  const { sendMessage, sendLink, sendFile } = useSenders({
    myIdRef,
    myNameRef,
    roomCodeRef: myCodeRef,
    addMsg,
    updateMsg,
    publish,
    getMode: () => modeRef.current,
  });

  /* ── Start room ──────────────────────────────────────────── */
  const startRoom = useCallback(
    async (code: string, name: string, serverUrl?: string) => {
      destroyed.current = false;
      myNameRef.current = name;
      myCodeRef.current = code;
      peers.current.clear();
      chunks.current.clear();
      setMessages([]);
      setPeerCount(0);
      setPeerList([]);
      setError(null);
      setFingerprint("");
      setIsOnline(true);
      isOnlineRef.current = true;
      setStatus("connecting");
      setRoom({
        code,
        link: roomLink(code),
        createdAt: Date.now(),
        peerCount: 0,
      });

      const fp = await keyFingerprint(code);
      setFingerprint(fp);

      await brokerConnect(code, name, serverUrl);
      if (destroyed.current) return;

      setMode(modeRef.current || "mqtt");
      setStatus("connected");
      await announcePresence();

      const modeLabel =
        modeRef.current === "server"
          ? "🖥️ Connected via server"
          : "📡 Connected via relay broker";
      addSystem(modeLabel);

      // ✅ Show file transfer speed info based on mode
      if (modeRef.current === "server") {
        addSystem("⚡ Fast file transfer enabled (128KB chunks, no delay)");
      }

      addSystem("🔐 All messages are end-to-end encrypted");
      addSystem(`🔑 Key fingerprint: ${fp}`);
      window.history.replaceState({}, "", `?room=${code}`);

      startTimers();
    },
    [brokerConnect, announcePresence, addSystem, startTimers, modeRef],
  );

  const createRoom = useCallback(
    (name: string, serverUrl?: string) =>
      startRoom(generateCode(), name, serverUrl),
    [startRoom],
  );

  const joinRoom = useCallback(
    (code: string, name: string, serverUrl?: string) =>
      startRoom(code.trim().toUpperCase(), name.trim(), serverUrl),
    [startRoom],
  );

  /* ── Send leave (MQTT only) ──────────────────────────────── */
  const sendLeave = useCallback(async () => {
    const code = myCodeRef.current;
    if (!code) return;

    if (modeRef.current === "server") {
      console.log("[useChat] Server mode — WS close triggers leave");
      return;
    }

    const client = clientRef.current;
    if (!client?.connected) return;
    try {
      const leaveMsg: PresencePayload = {
        id: myIdRef.current,
        name: myNameRef.current,
        action: "leave",
      };
      const enc = await encryptPayload(leaveMsg, code);
      const envelope: WireEnvelope = { v: 1, enc };
      await new Promise<void>((resolve, reject) => {
        client.publish(
          roomTopics(code).presence,
          JSON.stringify(envelope),
          { qos: 1 },
          (err) => {
            if (err) reject(err);
            else resolve();
          },
        );
      });
      console.log("[useChat] Leave message sent");
    } catch (err) {
      console.warn("[useChat] Leave message failed:", err);
    }
  }, [modeRef]);

  /* ── Disconnect ──────────────────────────────────────────── */
  const disconnect = useCallback(async () => {
    destroyed.current = true;
    stopTimers();
    try {
      await sendLeave();
    } catch {
      /* */
    }
    brokerDisconnectAll();
    peers.current.clear();
    chunks.current.clear();
    myIdRef.current = uuidv4();
    myCodeRef.current = "";
    myNameRef.current = "";
    setRoom(null);
    setMessages([]);
    setPeerCount(0);
    setPeerList([]);
    setStatus("idle");
    setError(null);
    setFingerprint("");
    setIsOnline(true);
    isOnlineRef.current = true;
    setMode("mqtt");
    window.history.replaceState({}, "", window.location.pathname);
    console.log("[useChat] Disconnected");
  }, [sendLeave, stopTimers, brokerDisconnectAll]);

  /* ── Tab close ───────────────────────────────────────────── */
  useEffect(() => {
    const handleUnload = () => {
      if (destroyed.current) return;
      const code = myCodeRef.current;
      if (!code) return;

      if (modeRef.current === "mqtt") {
        const client = clientRef.current;
        if (!client?.connected) return;
        const plain: PresencePayload = {
          id: myIdRef.current,
          name: myNameRef.current,
          action: "leave",
        };
        client.publish(
          roomTopics(code).presence,
          JSON.stringify({ v: 0, plain }),
          { qos: 0 },
        );
      }

      if (modeRef.current === "server") {
        brokerDisconnectAll();
      }
    };
    window.addEventListener("beforeunload", handleUnload);
    window.addEventListener("pagehide", handleUnload);
    return () => {
      window.removeEventListener("beforeunload", handleUnload);
      window.removeEventListener("pagehide", handleUnload);
    };
  }, [modeRef, brokerDisconnectAll]);

  /* ── Cleanup on unmount ──────────────────────────────────── */
  useEffect(() => {
    return () => {
      destroyed.current = true;
      stopTimers();
      brokerDisconnectAll();
    };
  }, [stopTimers, brokerDisconnectAll]);

  return {
    status,
    room,
    messages,
    peerCount,
    peers: peerList,
    error,
    fingerprint,
    isOnline,
    mode,
    myName: myNameRef.current,
    isDemo: false,
    createRoom,
    joinRoom,
    sendMessage,
    sendLink,
    sendFile,
    disconnect,
    activeCall,
    localStream,
    remoteStream,
    isAudioMuted,
    isVideoMuted,
    callError,
    startCall,
    acceptCall,
    rejectCall,
    hangup,
    toggleAudio,
    toggleVideo,
  };
}
