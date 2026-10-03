// PubSub over gossipsub (§5.5.1). Joins come from gossipsub subscription
// changes; a peer leaves a topic when it unsubscribes or disconnects, which
// gossipsub does not report as a subscription change.

import type { GossipSubEvents, Message } from '@libp2p/gossipsub'
import type { PeerId } from '@libp2p/interface'

import { notify_all, type MessageHandler, type PeerHandler, type PubSub } from '#fabric/pubsub.ts'
import type { RecordLibp2p } from './node.ts'

const sender_of = (message: Message): string | undefined =>
  message.type === 'signed' ? message.from.toString() : undefined

export const create_gossipsub_pubsub = ({ libp2p }: { libp2p: RecordLibp2p }): PubSub & { close: () => void } => {
  const gossipsub = libp2p.services.pubsub
  const handlers = new Map<string, MessageHandler>()
  const joins = new Map<string, Set<PeerHandler>>()
  const leaves = new Map<string, Set<PeerHandler>>()
  // Topic to the remote peers known to be subscribed.
  const members = new Map<string, Set<string>>()

  const add_handler = (map: Map<string, Set<PeerHandler>>, topic: string, handler: PeerHandler) => {
    const set = map.get(topic) ?? new Set()
    map.set(topic, set.add(handler))
    return () => { set.delete(handler) }
  }

  const join = (topic: string, peer_id: string) => {
    const set = members.get(topic) ?? new Set()
    members.set(topic, set)
    if (set.has(peer_id)) return
    set.add(peer_id)
    notify_all(joins.get(topic), peer_id)
  }

  const leave = (topic: string, peer_id: string) => {
    if (members.get(topic)?.delete(peer_id) !== true) return
    notify_all(leaves.get(topic), peer_id)
  }

  const on_message = ({ detail }: GossipSubEvents['message']) => {
    const from = sender_of(detail)
    if (from === undefined || from === libp2p.peerId.toString()) return
    handlers.get(detail.topic)?.({ from, data: detail.data })
  }

  const on_subscription_change = ({ detail }: GossipSubEvents['subscription-change']) => {
    const peer_id = detail.peerId.toString()
    for (const { topic, subscribe } of detail.subscriptions) {
      if (subscribe) join(topic, peer_id)
      else leave(topic, peer_id)
    }
  }

  const on_disconnect = ({ detail }: CustomEvent<PeerId>) => {
    const peer_id = detail.toString()
    for (const topic of members.keys()) leave(topic, peer_id)
  }

  gossipsub.addEventListener('message', on_message)
  gossipsub.addEventListener('subscription-change', on_subscription_change)
  libp2p.addEventListener('peer:disconnect', on_disconnect)

  return {
    peer_id: libp2p.peerId.toString(),
    // Gossipsub carries a topic of any length, so none is refused here.
    subscribe: async (topic, handler) => {
      handlers.set(topic, handler)
      gossipsub.subscribe(topic)
      // A peer already subscribed before this one was listening counts as joined.
      for (const peer of gossipsub.getSubscribers(topic)) join(topic, peer.toString())
    },
    unsubscribe: async (topic) => {
      handlers.delete(topic)
      gossipsub.unsubscribe(topic)
    },
    publish: async (topic, data) => { await gossipsub.publish(topic, data) },
    on_peer_join: (topic, handler) => add_handler(joins, topic, handler),
    on_peer_leave: (topic, handler) => add_handler(leaves, topic, handler),
    subscribers: (topic) => gossipsub.getSubscribers(topic).map((peer) => peer.toString()),
    close: () => {
      gossipsub.removeEventListener('message', on_message)
      gossipsub.removeEventListener('subscription-change', on_subscription_change)
      libp2p.removeEventListener('peer:disconnect', on_disconnect)
    }
  }
}
