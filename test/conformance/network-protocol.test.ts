// Discovery, announcements, heads exchange, merge, disconnect, and profile (§5).
// The F6 message vectors run against src/replication/messages.ts and
// src/entry, and the F7 import vectors against the Helia content store; the
// network behaviour lands with the replication stage.

import { describe, expect, test } from 'bun:test'

import { create_helia_content_store } from '#adapter/libp2p/content-store.ts'
import { compute_about_id } from '#entry/id.ts'
import { assert_signed_entry_shape } from '#entry/signed.ts'
import { build_loaded_about_entry, encode_heads_message } from '#replication/messages.ts'
import { create_offline_helia } from '#test/helpers/helia.ts'
import { content_cid_of } from '#test/helpers/library.ts'
import {
  audio_pipeline_vector,
  build_multi_block_input,
  heads_message_vector,
  loaded_about_entry_vector,
  multi_block_vector,
  NETWORK_MESSAGE_SIZE_BOUND,
  signed_entry_vector
} from './vectors.ts'

const import_with_helia = async (source: string | Uint8Array) => {
  const helia = await create_offline_helia()
  try {
    return await create_helia_content_store({ helia }).import_blob(source)
  } finally {
    await helia.stop()
  }
}

describe('network-protocol', () => {
  test.todo('§5.2 [MUST] the peer bootstraps from any one discovery mechanism alone', () => {})
  test.todo('§5.2 [MUST] content-network native discovery is supported', () => {})
  test.todo('§5.3.1 [MUST] peers publish and subscribe to topic RECORD, bytes 52 45 43 4f 52 44', () => {})
  test.todo('§5.3.1 [MUST] a library topic too long for the pubsub runtime surfaces an error instead of truncating or hashing', () => {})
  test('§5.3.2 [vector] F6 LoadedAboutEntry inlines the about payload and serialises to 1060 bytes', () => {
    const { message } = loaded_about_entry_vector
    const about_content = message.payload.value.content
    expect<string>(message.payload.key).toBe(compute_about_id(about_content.address))
    // The signed entry carries the about content CID; the announcement inlines the payload.
    const { hash, payload, ...fields } = message
    const entry = assert_signed_entry_shape({
      ...fields,
      payload: { ...payload, value: { ...payload.value, content: content_cid_of(about_content) } }
    })
    const loaded = build_loaded_about_entry({ hash, entry, about_content })
    const json = JSON.stringify(loaded)
    expect(Buffer.byteLength(json)).toBe(loaded_about_entry_vector.json_byte_length)
    expect(json).toBe(JSON.stringify(message))
  })
  test.todo('§5.3.2 [MUST] announcements are JSON-encoded and published via pubsub', () => {})
  test.todo('§5.3.2 [MUST] an announced about entry is authenticated only after re-fetching the canonical entry by hash', () => {})
  test.todo('§5.3.2 [MUST] announcements over 256 KiB of JSON are not sent', () => {})
  test.todo('§5.3.2 [MUST] received announcements over 256 KiB are dropped unprocessed', () => {})
  test.todo('§5.3.2 [MUST] announcement content is an untrusted hint until the AC chain and signatures verify', () => {})
  test.todo('§5.3.3 [MUST] at most one announcement per RECORD peer-join per 5 seconds per target peer', () => {})
  test.todo('§5.3.3 [MUST] library state changes are not re-announced on RECORD', () => {})
  test.todo('§5.3.3 [MUST] a missing announcement is not taken to mean the library does not exist', () => {})
  test('§5.4.1 [vector] the single-entry heads message is the 122-byte spec JSON', () => {
    const json = encode_heads_message({ heads: [signed_entry_vector.entry_hash] })
    expect(json).toBe(heads_message_vector.json)
    expect(Buffer.byteLength(json)).toBe(heads_message_vector.json_byte_length)
    expect(Buffer.byteLength(json)).toBeLessThanOrEqual(NETWORK_MESSAGE_SIZE_BOUND)
  })
  test.todo('§5.4.1 [MUST] each heads element is the base58btc CID of a current head', () => {})
  test.todo('§5.4.1 [MUST] heads are published on first subscribing to the library topic', () => {})
  test.todo('§5.4.1 [MUST] heads are published when a new peer joins the topic', () => {})
  test.todo('§5.4.1 [MUST] heads are published when the local heads set changes', () => {})
  test.todo('§5.4.1 [MUST] heads are published at most once per 1000 ms per library', () => {})
  test.todo('§5.4.1 [MUST] simultaneous heads triggers coalesce into one message', () => {})
  test.todo('§5.4.1 [MUST] a heads message does not exceed 256 KiB of JSON', () => {})
  test.todo('§5.4.1 [MUST] an oversized heads set splits across messages from the same trigger', () => {})
  test.todo('§5.4.1 [MUST] every split heads message but the last carries incomplete: true', () => {})
  test.todo('§5.4.1 [MUST] receivers treat a split batch as complete only after the message without incomplete: true', () => {})
  test.todo('§5.4.3 [MUST] incremental merge batches never include entries with unfetched ancestors', () => {})
  test.todo('§5.4.3 [MUST] concurrent heads messages for one library end in a state equal to some sequential merge order', () => {})
  test.todo('§5.4.3 [MUST] parallelised merges uphold the §4.5 invariants', () => {})
  test.todo('§5.4.4 [MUST] replication pauses for one library without closing its log', () => {})
  test.todo('§5.4.4 [MUST] pause stops heads publishing and new fetch tasks while in-flight fetches finish or time out', () => {})
  test.todo('§5.4.4 [MUST] entries in flight at pause are recorded as unresolved', () => {})
  test.todo('§5.4.4 [MUST] resume re-enters traversal for unresolved entries before publishing heads', () => {})
  test.todo('§5.4.4 [MUST] resume does not re-fetch entries that already landed', () => {})
  test.todo('§5.4.5 [MUST] heads referencing unfetchable CIDs are tolerated', () => {})
  test.todo('§5.4.5 [MUST] a per-entry timeout does not stall the replicator', () => {})
  test.todo('§5.4.5 [MUST] an unreachable library keeps its local oplog', () => {})
  test.todo('§5.4.5 [MUST] fetch failures never emit a library-removed signal', () => {})
  test.todo('§5.5 [MUST] the peer implements the §5.5.1 libp2p profile', () => {})
  test.todo('§5.5.1 [MUST] the pubsub router is gossipsub', () => {})
  test.todo('§5.5.1 [MUST] the swarm uses the Record pre-shared key', () => {})
  test('§5.5.1 [vector] F7 the fixture audio imports with unixfs-v1-2025 to its base58btc content.hash', async () => {
    expect(await import_with_helia(audio_pipeline_vector.fixture_path)).toBe(audio_pipeline_vector.audio_cid)
  })
  test('§5.5.1 [vector] F7 a 2 MiB+1 blob imports with unixfs-v1-2025 to the multi-block CID', async () => {
    expect(await import_with_helia(build_multi_block_input())).toBe(multi_block_vector.cid)
  })
})
