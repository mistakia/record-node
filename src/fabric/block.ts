// Block handling shared by the ContentStore backends: CID parsing, digest
// verification, DAG walking, and blob import.

import { createReadStream } from 'node:fs'
import { decode as decode_dag_cbor, code as DAG_CBOR_CODE } from '@ipld/dag-cbor'
import { decode as decode_dag_pb, code as DAG_PB_CODE } from '@ipld/dag-pb'
import { sha256 } from '@noble/hashes/sha2.js'
import { sha3_512 } from '@noble/hashes/sha3.js'
import { importer } from 'ipfs-unixfs-importer'
import { base58btc } from 'multiformats/bases/base58'
import { CID } from 'multiformats/cid'
import { equals } from 'multiformats/bytes'
import { code as RAW_CODE } from 'multiformats/codecs/raw'

import { SHA3_512_CODE } from '#encoding/cid.ts'
import { ProtocolError } from '#types/errors.ts'
import { CONTENT_IMPORT_PROFILE, type BlobSource } from './content-store.ts'

const SHA2_256_CODE = 0x12

// sha3-512 for protocol objects (§2.1), sha2-256 for the §5.5.1 import profile.
const DIGESTS: ReadonlyMap<number, (bytes: Uint8Array) => Uint8Array> = new Map([
  [SHA2_256_CODE, sha256],
  [SHA3_512_CODE, sha3_512]
])

// Accepts any valid CID string, CIDv0 included (§5.5.1 readers).
export const parse_content_cid = (cid_string: string): CID => {
  try {
    return CID.parse(cid_string)
  } catch {
    throw new ProtocolError('invalid_cid', `not a CID: ${cid_string}`)
  }
}

export const format_cid = (cid: CID): string => cid.toString(base58btc)

export const verify_block = ({ cid, bytes }: { cid: CID, bytes: Uint8Array }): void => {
  const digest = DIGESTS.get(cid.multihash.code)
  if (digest === undefined) {
    throw new ProtocolError('invalid_cid', `unsupported multihash 0x${cid.multihash.code.toString(16)}: ${format_cid(cid)}`)
  }
  if (!equals(digest(bytes), cid.multihash.digest)) {
    throw new ProtocolError('cid_mismatch', `bytes do not hash to ${format_cid(cid)}`)
  }
}

const cbor_links = (value: unknown): CID[] => {
  const cid = CID.asCID(value)
  if (cid !== null) return [cid]
  if (value === null || typeof value !== 'object') return []
  return Object.values(value).flatMap(cbor_links)
}

const links_of = ({ cid, bytes }: { cid: CID, bytes: Uint8Array }): CID[] => {
  switch (cid.code) {
    case RAW_CODE: return []
    case DAG_PB_CODE: return decode_dag_pb(bytes).Links.map(({ Hash }) => CID.asCID(Hash) ?? Hash)
    case DAG_CBOR_CODE: return cbor_links(decode_dag_cbor(bytes))
    default: throw new ProtocolError('invalid_cid', `unsupported codec 0x${cid.code.toString(16)}: ${format_cid(cid)}`)
  }
}

// The CID and, when recursive, every block under it, each once, root first.
// Rejects with content_unavailable when a block is not stored. Only blocks
// whose links are needed are read; the rest, a blob's raw leaves among them,
// are checked with has, so a walk never reads the audio back.
export const walk_blocks = async ({ cid, recursive, read, has }: {
  cid: CID
  recursive: boolean
  read: (cid: CID) => Promise<Uint8Array | undefined>
  has: (cid: CID) => Promise<boolean>
}): Promise<CID[]> => {
  const visited = new Map<string, CID>()
  const visit = async (next: CID) => {
    const key = format_cid(next)
    if (visited.has(key)) return
    const missing = () => new ProtocolError('content_unavailable', `block not stored: ${key}`)
    if (!recursive || next.code === RAW_CODE) {
      if (!(await has(next))) throw missing()
      visited.set(key, next)
      return
    }
    const bytes = await read(next)
    if (bytes === undefined) throw missing()
    visited.set(key, next)
    for (const link of links_of({ cid: next, bytes })) await visit(link)
  }
  await visit(cid)
  return [...visited.values()]
}

// Joins a block that a blockstore hands over in chunks.
export const collect_bytes = async (source: Uint8Array | Iterable<Uint8Array> | AsyncIterable<Uint8Array>): Promise<Uint8Array> => {
  if (source instanceof Uint8Array) return source
  const chunks: Uint8Array[] = []
  for await (const chunk of source) chunks.push(chunk)
  const bytes = new Uint8Array(chunks.reduce((length, chunk) => length + chunk.length, 0))
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.length
  }
  return bytes
}

type BlockSink = Parameters<typeof importer>[1]

// Imports one blob as a single UnixFS file and returns its base58btc CID.
// The importer gets the §5.5.1 profile and nothing else: wrappers such as
// @helia/unixfs pass their own cidVersion, rawLeaves, chunker, and layout,
// which win over the profile.
export const import_unixfs_file = async ({ source, put }: {
  source: BlobSource
  put: (cid: Parameters<BlockSink['put']>[0], bytes: Uint8Array) => Promise<void>
}): Promise<string> => {
  const block_sink: BlockSink = {
    put: async (cid, bytes) => {
      await put(cid, await collect_bytes(bytes))
      return cid
    }
  }
  const content = typeof source === 'string' ? createReadStream(source) : source
  let root: string | undefined
  for await (const { cid } of importer([{ content }], block_sink, { profile: CONTENT_IMPORT_PROFILE })) {
    root = format_cid(cid)
  }
  if (root === undefined) throw new ProtocolError('content_unavailable', 'import produced no root')
  return root
}
