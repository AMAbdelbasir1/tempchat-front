/**
 * usePublish — encrypted MQTT publish helper.
 *
 * Wraps client.publish in a Promise that resolves ONLY after
 * the broker ACKs (QoS 1 PUBACK). This prevents fire-and-forget
 * chunk loss during file transfers.
 */

import { useCallback, RefObject } from 'react';
import { MqttClient } from 'mqtt';
import { encryptPayload } from '../../utils/crypto';
import type { WireEnvelope } from './types';

const MAX_RETRIES = 3;
const RETRY_DELAY = 500;

export function usePublish(
  clientRef:   RefObject<MqttClient | null>,
  roomCodeRef: RefObject<string>,
) {
  const publish = useCallback(
    async (topic: string, payload: unknown): Promise<void> => {
      const client = clientRef.current;
      const code   = roomCodeRef.current;

      if (!client || !client.connected || !code) {
        console.warn('[usePublish] Cannot publish — not connected or no room code');
        return;
      }

      const enc: string            = await encryptPayload(payload, code);
      const envelope: WireEnvelope = { v: 1, enc };
      const data                   = JSON.stringify(envelope);

      // Publish with QoS 1 and WAIT for broker ACK via callback
      // Retry up to MAX_RETRIES times on failure
      for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        try {
          await new Promise<void>((resolve, reject) => {
            client.publish(topic, data, { qos: 1 }, (err) => {
              if (err) reject(err);
              else resolve();
            });
          });
          return; // success — exit
        } catch (err) {
          if (attempt < MAX_RETRIES) {
            console.warn(`[usePublish] Retry ${attempt + 1}/${MAX_RETRIES} for ${topic}`);
            await new Promise(r => setTimeout(r, RETRY_DELAY));
          } else {
            console.error(`[usePublish] Failed after ${MAX_RETRIES} retries:`, err);
            throw err;
          }
        }
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  return publish;
}
