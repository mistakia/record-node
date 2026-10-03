// Publish-subscribe boundary (§5.1, §5.3.1): the RECORD announcement topic
// and one replication topic per library address. Messages are raw bytes; the
// replication engine owns their JSON bodies.

import { utf8ToBytes } from '@noble/hashes/utils.js'

import { ProtocolError } from '#types/errors.ts'

// Exactly the six ASCII bytes 52 45 43 4f 52 44 (§5.3.1).
export const RECORD_TOPIC = 'RECORD'

export interface PubSubMessage {
  // The sending peer's id.
  readonly from: string
  readonly data: Uint8Array
}

export type MessageHandler = (message: PubSubMessage) => void
export type PeerHandler = (peer_id: string) => void

export interface PubSub {
  readonly peer_id: string
  // Rejects with topic_too_long instead of truncating or hashing a topic the
  // runtime cannot carry (§5.3.1).
  subscribe: (topic: string, handler: MessageHandler) => Promise<void>
  unsubscribe: (topic: string) => Promise<void>
  // Own messages are never delivered back to the publisher.
  publish: (topic: string, data: Uint8Array) => Promise<void>
  // A remote peer subscribed to, or left, the topic. Each returns its removal.
  on_peer_join: (topic: string, handler: PeerHandler) => () => void
  on_peer_leave: (topic: string, handler: PeerHandler) => () => void
  // The remote peers currently subscribed to the topic.
  subscribers: (topic: string) => string[]
}

// A runtime with no topic length limit passes undefined.
export const assert_topic_fits = ({ topic, max_topic_bytes }: { topic: string, max_topic_bytes: number | undefined }): void => {
  const size = utf8ToBytes(topic).length
  if (max_topic_bytes !== undefined && size > max_topic_bytes) {
    throw new ProtocolError('topic_too_long', `topic is ${size} bytes, over the pubsub runtime's ${max_topic_bytes}-byte limit: ${topic}`)
  }
}

// Calls every handler in a set, so one that throws never stops the others.
export const notify_all = <T>(handlers: Iterable<(value: T) => void> | undefined, value: T): void => {
  for (const handler of handlers ?? []) {
    try {
      handler(value)
    } catch (error) {
      process.emitWarning(`pubsub handler threw: ${(error as Error).message}`)
    }
  }
}
