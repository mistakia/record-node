// UnixFS range reads over the §5.5.1 profile and the legacy layouts readers
// still accept: which blocks a range touches, the bytes it yields, and the
// size checks that keep a declared length true to the bytes behind it.

import { describe, expect, test } from 'bun:test'
import { encode as encode_dag_pb, prepare, code as DAG_PB_CODE } from '@ipld/dag-pb'
import { UnixFS } from 'ipfs-unixfs'
import { importer } from 'ipfs-unixfs-importer'
import { fixedSize } from 'ipfs-unixfs-importer/chunker'
import { balanced } from 'ipfs-unixfs-importer/layout'
import { CID } from 'multiformats/cid'
import { code as RAW_CODE } from 'multiformats/codecs/raw'
import { sha256 } from 'multiformats/hashes/sha2'

import { collect_bytes, format_cid, import_unixfs_file } from '#fabric/block.ts'
import { has_unixfs_file, open_unixfs_file, read_unixfs_file, visit_unixfs_file } from '#fabric/unixfs.ts'
import { ProtocolError } from '#types/errors.ts'

const MIB = 1024 * 1024

const pattern = (length: number) => Uint8Array.from({ length }, (_, index) => (index * 7 + (index >> 10)) % 251)

// A block map with every read and has recorded.
const store = () => {
  const blocks = new Map<string, Uint8Array>()
  const reads: string[] = []
  const has_calls: string[] = []
  return {
    blocks,
    reads,
    has_calls,
    put: (cid: CID, bytes: Uint8Array) => { blocks.set(format_cid(cid), bytes) },
    read: async (cid: string) => {
      reads.push(cid)
      return blocks.get(cid)
    },
    has: async (cid: string) => {
      has_calls.push(cid)
      return blocks.has(cid)
    }
  }
}

const import_profile = async (bytes: Uint8Array) => {
  const blocks = store()
  const cid = await import_unixfs_file({ source: bytes, put: async (cid, block) => { blocks.put(cid, block) } })
  return { blocks, cid }
}

// CIDv0, dag-pb leaves of 1000 bytes, three links per node: a multi-level tree.
const import_legacy = async (bytes: Uint8Array) => {
  const blocks = store()
  let root: CID | undefined
  const sink = { put: async (cid: CID, block: Uint8Array) => { blocks.put(cid, await collect_bytes(block)); return cid } }
  for await (const { cid } of importer([{ content: bytes }], sink as never, {
    cidVersion: 0,
    rawLeaves: false,
    chunker: fixedSize({ chunkSize: 1000 }),
    layout: balanced({ maxChildrenPerNode: 3 })
  })) root = cid
  return { blocks, cid: format_cid(root!) }
}

const raw_block = async (bytes: Uint8Array) => ({ cid: CID.createV1(RAW_CODE, await sha256.digest(bytes)), bytes })

const file_node = async ({ data, links, block_sizes }: { data?: Uint8Array, links: CID[], block_sizes: number[] }) => {
  const unixfs = new UnixFS({ type: 'file', ...(data === undefined ? {} : { data }), blockSizes: block_sizes.map(BigInt) })
  const bytes = encode_dag_pb(prepare({ Data: unixfs.marshal(), Links: links.map((Hash) => ({ Hash })) }))
  return { cid: CID.createV1(DAG_PB_CODE, await sha256.digest(bytes)), bytes }
}

const read_range = async (cid: string, read: (cid: string) => Promise<Uint8Array | undefined>, start_offset: number, end_offset: number) => {
  const file = await open_unixfs_file({ cid, read })
  return await collect_bytes(file!.read_range({ start_offset, end_offset }))
}

const rejection = async (promise: Promise<unknown>) => {
  try {
    await promise
  } catch (error) {
    return error
  }
  throw new Error('expected a rejection')
}

describe('unixfs-v1-2025 file of 2.5 MiB', async () => {
  const bytes = pattern(2.5 * MIB)
  const { blocks, cid } = await import_profile(bytes)

  test('declares its size from the root alone', async () => {
    blocks.reads.length = 0
    const file = await open_unixfs_file({ cid, read: blocks.read })
    expect(file?.file_size).toBe(bytes.length)
    expect(blocks.reads).toEqual([cid])
  })

  test('yields the bytes of any range', async () => {
    for (const [start, end] of [[0, 0], [5, 5], [MIB - 10, MIB + 9], [0, MIB - 1], [MIB, 2 * MIB - 1], [bytes.length - 1, bytes.length - 1], [0, bytes.length - 1]] as const) {
      expect(await read_range(cid, blocks.read, start, end)).toEqual(bytes.subarray(start, end + 1))
    }
  })

  test('reads only the root and the leaves covering the range', async () => {
    blocks.reads.length = 0
    await read_range(cid, blocks.read, MIB - 10, MIB + 9)
    expect(blocks.reads).toHaveLength(3)
    blocks.reads.length = 0
    await read_range(cid, blocks.read, 2 * MIB + 1, 2 * MIB + 1)
    expect(blocks.reads).toHaveLength(2)
  })

  test('reads back whole and visits every block', async () => {
    expect(await read_unixfs_file({ cid, read: blocks.read })).toEqual(bytes)
    blocks.reads.length = 0
    expect(await visit_unixfs_file({ cid, read: blocks.read })).toBe(true)
    expect(blocks.reads).toHaveLength(blocks.blocks.size)
  })

  test('has checks the leaves without reading them', async () => {
    blocks.reads.length = 0
    blocks.has_calls.length = 0
    expect(await has_unixfs_file({ cid, read: blocks.read, has: blocks.has })).toBe(true)
    expect(blocks.reads).toEqual([cid])
    expect(blocks.has_calls).toHaveLength(3)
  })

  test('refuses a range outside the file', async () => {
    const file = await open_unixfs_file({ cid, read: blocks.read })
    expect(() => file!.read_range({ start_offset: 0, end_offset: bytes.length })).toThrow(RangeError)
    expect(() => file!.read_range({ start_offset: 10, end_offset: 9 })).toThrow(RangeError)
  })

  test('applies max_bytes to the declared size before reading a leaf', async () => {
    blocks.reads.length = 0
    const error = await rejection(open_unixfs_file({ cid, read: blocks.read, max_bytes: 2 * MIB }))
    expect((error as ProtocolError).code).toBe('size_exceeded')
    expect(blocks.reads).toEqual([cid])
  })
})

describe('a missing leaf', async () => {
  const bytes = pattern(2.5 * MIB)
  const { blocks, cid } = await import_profile(bytes)
  const leaves = [...blocks.blocks.keys()].filter((key) => key !== cid)
  blocks.blocks.delete(leaves[1]!)

  test('rejects only a range that covers it', async () => {
    expect(await read_range(cid, blocks.read, 0, 99)).toEqual(bytes.subarray(0, 100))
    const error = await rejection(read_range(cid, blocks.read, 0, bytes.length - 1))
    expect((error as ProtocolError).code).toBe('content_unavailable')
  })

  test('reads as not held', async () => {
    expect(await has_unixfs_file({ cid, read: blocks.read, has: blocks.has })).toBe(false)
  })
})

describe('a file of at most one chunk', () => {
  test('is a single raw block whose length is its size', async () => {
    const bytes = pattern(4000)
    const { blocks, cid } = await import_profile(bytes)
    expect(blocks.blocks.size).toBe(1)
    const file = await open_unixfs_file({ cid, read: blocks.read })
    expect(file?.file_size).toBe(4000)
    expect(await read_range(cid, blocks.read, 100, 199)).toEqual(bytes.subarray(100, 200))
    expect(await has_unixfs_file({ cid, read: blocks.read, has: blocks.has })).toBe(true)
    const error = await rejection(open_unixfs_file({ cid, read: blocks.read, max_bytes: 3999 }))
    expect((error as ProtocolError).code).toBe('size_exceeded')
  })

  test('declares size zero when empty', async () => {
    const { blocks, cid } = await import_profile(new Uint8Array(0))
    expect((await open_unixfs_file({ cid, read: blocks.read }))?.file_size).toBe(0)
    expect(await read_unixfs_file({ cid, read: blocks.read })).toEqual(new Uint8Array(0))
    expect(await visit_unixfs_file({ cid, read: blocks.read })).toBe(true)
  })
})

describe('legacy CIDv0 file with dag-pb leaves over several levels', async () => {
  const bytes = pattern(10_500)
  const { blocks, cid } = await import_legacy(bytes)

  test('is the multi-level shape under test', async () => {
    expect(cid.startsWith('Qm')).toBe(true)
    expect(blocks.blocks.size).toBeGreaterThan(11 + 4)
  })

  test('yields the bytes of any range and reads only the covering path', async () => {
    for (const [start, end] of [[0, 0], [999, 1000], [2990, 3010], [5000, 7999], [10_499, 10_499], [0, 10_499]] as const) {
      expect(await read_range(cid, blocks.read, start, end)).toEqual(bytes.subarray(start, end + 1))
    }
    blocks.reads.length = 0
    await read_range(cid, blocks.read, 4500, 4500)
    expect(blocks.reads.length).toBeLessThanOrEqual(4)
  })

  test('has reads dag-pb leaves, having no raw leaf to only ask about', async () => {
    blocks.reads.length = 0
    blocks.has_calls.length = 0
    expect(await has_unixfs_file({ cid, read: blocks.read, has: blocks.has })).toBe(true)
    expect(blocks.has_calls).toEqual([])
    expect(blocks.reads).toHaveLength(blocks.blocks.size)
  })
})

describe('inline data ahead of links', async () => {
  const first = await raw_block(pattern(300))
  const second = await raw_block(pattern(200).reverse())
  const head = new TextEncoder().encode('head')
  const root = await file_node({ data: head, links: [first.cid, second.cid], block_sizes: [300, 200] })
  const blocks = store()
  for (const block of [first, second, root]) blocks.put(block.cid, block.bytes)
  const cid = format_cid(root.cid)
  const whole = new Uint8Array([...head, ...first.bytes, ...second.bytes])

  test('places the data first and the links after it', async () => {
    expect((await open_unixfs_file({ cid, read: blocks.read }))?.file_size).toBe(504)
    for (const [start, end] of [[0, 3], [2, 6], [303, 304], [503, 503], [0, 503]] as const) {
      expect(await read_range(cid, blocks.read, start, end)).toEqual(whole.subarray(start, end + 1))
    }
    blocks.reads.length = 0
    await read_range(cid, blocks.read, 0, 3)
    expect(blocks.reads).toEqual([cid])
  })
})

describe('an empty linked block', async () => {
  const leaf = await raw_block(pattern(300))
  const empty = await raw_block(new Uint8Array(0))
  const root = await file_node({ links: [leaf.cid, empty.cid], block_sizes: [300, 0] })
  const cid = format_cid(root.cid)

  test('is read by a visit and asked about by has, so neither passes without it', async () => {
    const blocks = store()
    for (const block of [leaf, root]) blocks.put(block.cid, block.bytes)
    expect(await visit_unixfs_file({ cid, read: blocks.read })).toBe(false)
    expect(await has_unixfs_file({ cid, read: blocks.read, has: blocks.has })).toBe(false)
    blocks.put(empty.cid, empty.bytes)
    expect(await visit_unixfs_file({ cid, read: blocks.read })).toBe(true)
    expect(await has_unixfs_file({ cid, read: blocks.read, has: blocks.has })).toBe(true)
    expect(await read_range(cid, blocks.read, 0, 299)).toEqual(leaf.bytes)
  })
})

describe('sizes that disagree', async () => {
  const leaf = await raw_block(pattern(300))
  const other = await raw_block(pattern(100))

  const shape_error = async (root: { cid: CID, bytes: Uint8Array }, extra: Array<{ cid: CID, bytes: Uint8Array }> = []) => {
    const blocks = store()
    for (const block of [leaf, other, root, ...extra]) blocks.put(block.cid, block.bytes)
    const cid = format_cid(root.cid)
    const file = await open_unixfs_file({ cid, read: blocks.read })
    return await rejection(collect_bytes(file!.read_range({ start_offset: 0, end_offset: file!.file_size - 1 })))
  }

  test('a leaf longer than its parent declares is invalid_shape', async () => {
    const error = await shape_error(await file_node({ links: [leaf.cid, other.cid], block_sizes: [200, 100] }))
    expect((error as ProtocolError).code).toBe('invalid_shape')
  })

  test('an inner node whose size differs from its parent declaration is invalid_shape', async () => {
    const inner = await file_node({ links: [leaf.cid, other.cid], block_sizes: [300, 100] })
    const error = await shape_error(await file_node({ links: [inner.cid], block_sizes: [350] }), [inner])
    expect((error as ProtocolError).code).toBe('invalid_shape')
  })

  test('links and block sizes of different number are invalid_shape at open', async () => {
    const root = await file_node({ links: [leaf.cid, other.cid], block_sizes: [300] })
    const blocks = store()
    for (const block of [leaf, other, root]) blocks.put(block.cid, block.bytes)
    const error = await rejection(open_unixfs_file({ cid: format_cid(root.cid), read: blocks.read }))
    expect((error as ProtocolError).code).toBe('invalid_shape')
  })
})
