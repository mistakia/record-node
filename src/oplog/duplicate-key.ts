// The §2.10 duplicate_key tuple: (library_address, envelope.id,
// envelope.content, sorted(envelope.tags)), a missing tags field counting as [].

import type { Envelope } from '#types/entry.ts'

export const duplicate_key = ({ library_address, envelope }: {
  library_address: string
  envelope: Envelope
}): string => JSON.stringify([
  library_address,
  envelope.id,
  envelope.content,
  [...(envelope.tags ?? [])].sort()
])
