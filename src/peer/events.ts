// The peer's event fan-out: the callbacks behind ApiPeer.subscribe.

import type { PeerEvent } from '#types/peer.ts'

export interface EventBus {
  emit: (event: PeerEvent) => void
  subscribe: (handler: (event: PeerEvent) => void) => () => void
}

// A handler that throws never stops the emitter or the other handlers.
export const create_event_bus = (): EventBus => {
  const handlers = new Set<(event: PeerEvent) => void>()
  return {
    emit: (event) => {
      for (const handler of handlers) {
        try {
          handler(event)
        } catch (error) {
          process.emitWarning(`peer event handler for ${event.type} threw: ${(error as Error).message}`)
        }
      }
    },
    subscribe: (handler) => {
      handlers.add(handler)
      return () => { handlers.delete(handler) }
    }
  }
}
