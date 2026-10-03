// Peers on one in-memory network, and bounded waits on their events, so
// replication tests wait on what happened rather than on the clock.

import { create_memory_network, type MemoryNetwork } from '#adapter/memory/network.ts'
import { create_peer, start_peer, stop_peer, type CreatePeerOptions, type Peer } from '#peer/peer.ts'
import type { PeerEvent } from '#types/peer.ts'
import { stored_track } from './library-manager.ts'

export const WAIT_MS = 10_000

export const preflight_bypassed = process.env.RECORD_TOOLCHAIN_PREFLIGHT === 'bypass'

// Resolves with the first event the predicate accepts, or rejects after
// timeout_ms. Register it before the action that should cause the event.
export const wait_for_event = (peer: Peer, accept: (event: PeerEvent) => boolean, timeout_ms = WAIT_MS): Promise<PeerEvent> =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      unsubscribe()
      reject(new Error(`no matching peer event within ${timeout_ms} ms`))
    }, timeout_ms)
    const unsubscribe = peer.subscribe((event) => {
      if (!accept(event)) return
      clearTimeout(timer)
      unsubscribe()
      resolve(event)
    })
  })

// Polls a condition each tick until it holds, or rejects after timeout_ms.
export const wait_until = async (condition: () => boolean | Promise<boolean>, timeout_ms = WAIT_MS): Promise<void> => {
  const deadline = Date.now() + timeout_ms
  while (!(await condition())) {
    if (Date.now() > deadline) throw new Error(`condition not met within ${timeout_ms} ms`)
    await new Promise((resolve) => setImmediate(resolve))
  }
}

export interface MemoryPeers {
  readonly network: MemoryNetwork
  readonly start: (options?: CreatePeerOptions) => Promise<Peer>
  readonly stop_all: () => Promise<void>
}

export const create_memory_peers = ({ network = create_memory_network() }: { network?: MemoryNetwork } = {}): MemoryPeers => {
  const running: Peer[] = []
  return {
    network,
    start: async (options = {}) => {
      const peer = await create_peer({
        ...options,
        config: { allow_toolchain_mismatch: preflight_bypassed, traversal_timeout_ms: 2000, ...options.config },
        network: ({ content_store }) => network.join({ content_store })
      })
      await start_peer(peer)
      running.push(peer)
      return peer
    },
    stop_all: async () => {
      for (const peer of running.splice(0)) await stop_peer(peer)
    }
  }
}

// Appends a track whose content and audio blob are in the peer's store.
export const append_track = async ({ peer, fingerprint, audio = fingerprint }: { peer: Peer, fingerprint: string, audio?: string }) => {
  const { key_pair, own_address } = peer.identity()
  const track = await stored_track({ content_store: peer.content_store, fingerprint, audio })
  const entry = await peer.context.libraries.append({ library_address: own_address, payload: track.payload, key_pair })
  return { ...track, entry }
}
