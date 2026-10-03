// Size bounds enforced at deserialization, before any signature check (§2.8.3).

import { utf8ToBytes } from '@noble/hashes/utils.js'

import { ProtocolError } from '#types/errors.ts'
import { encode_canonical } from './canonical-bytes.ts'

export const SIGNED_ENTRY_MAX_BYTES = 256 * 1024
export const PAYLOAD_MAX_BYTES = 1024 * 1024
export const ENVELOPE_TAGS_MAX_COUNT = 256
export const ENVELOPE_TAG_MAX_BYTES = 128
export const ENVELOPE_TAGS_MAX_SERIALISED_BYTES = 8 * 1024

const assert_max = ({ size, max, label }: { size: number, max: number, label: string }) => {
  if (size > max) throw new ProtocolError('size_exceeded', `${label} is ${size} bytes, over the ${max}-byte bound`)
}

export const assert_signed_entry_size = (bytes: Uint8Array) =>
  assert_max({ size: bytes.length, max: SIGNED_ENTRY_MAX_BYTES, label: 'signed entry' })

export const assert_payload_size = (bytes: Uint8Array) =>
  assert_max({ size: bytes.length, max: PAYLOAD_MAX_BYTES, label: 'envelope payload' })

export const assert_envelope_tags = (tags: unknown): readonly string[] => {
  if (!Array.isArray(tags) || !tags.every((tag) => typeof tag === 'string')) {
    throw new ProtocolError('invalid_shape', 'envelope tags must be an array of strings')
  }
  if (tags.length > ENVELOPE_TAGS_MAX_COUNT) {
    throw new ProtocolError('size_exceeded', `${tags.length} envelope tags, over the ${ENVELOPE_TAGS_MAX_COUNT} bound`)
  }
  for (const tag of tags) {
    assert_max({ size: utf8ToBytes(tag).length, max: ENVELOPE_TAG_MAX_BYTES, label: 'envelope tag' })
  }
  assert_max({ size: encode_canonical(tags).length, max: ENVELOPE_TAGS_MAX_SERIALISED_BYTES, label: 'envelope tags' })
  return tags
}
