// Reads a UnixFS file back out of local blocks: the bytes import_blob took
// in, not the root block. Links are followed depth-first in order, which is
// file order in every UnixFS layout; data on a dag-pb node precedes its links.

import { decode as decode_dag_pb, code as DAG_PB_CODE } from '@ipld/dag-pb'
import { UnixFS } from 'ipfs-unixfs'
import type { CID } from 'multiformats/cid'
import { code as RAW_CODE } from 'multiformats/codecs/raw'

import { ProtocolError } from '#types/errors.ts'
import { collect_bytes, format_cid, parse_content_cid } from './block.ts'

const FILE_TYPES = new Set(['file', 'raw'])

// Undefined when the root is not stored; rejects with content_unavailable
// when an inner block is missing and invalid_shape when the DAG is no file.
export const read_unixfs_file = async ({ cid, read }: {
  cid: string
  read: (cid: string) => Promise<Uint8Array | undefined>
}): Promise<Uint8Array | undefined> => {
  const root = parse_content_cid(cid)
  const root_bytes = await read(format_cid(root))
  if (root_bytes === undefined) return undefined

  const chunks: Uint8Array[] = []
  const visit = async (node: CID, bytes: Uint8Array): Promise<void> => {
    if (node.code === RAW_CODE) {
      chunks.push(bytes)
      return
    }
    if (node.code !== DAG_PB_CODE) throw new ProtocolError('invalid_shape', `not a UnixFS block: ${format_cid(node)}`)
    const { Data, Links } = decode_dag_pb(bytes)
    const unixfs = Data === undefined ? undefined : UnixFS.unmarshal(Data)
    if (unixfs === undefined || !FILE_TYPES.has(unixfs.type)) {
      throw new ProtocolError('invalid_shape', `not a UnixFS file: ${format_cid(node)}`)
    }
    if (unixfs.data !== undefined) chunks.push(unixfs.data)
    for (const { Hash } of Links) {
      const child = parse_content_cid(Hash.toString())
      const child_bytes = await read(format_cid(child))
      if (child_bytes === undefined) throw new ProtocolError('content_unavailable', `block not stored: ${format_cid(child)}`)
      await visit(child, child_bytes)
    }
  }
  await visit(root, root_bytes)
  return await collect_bytes(chunks)
}
