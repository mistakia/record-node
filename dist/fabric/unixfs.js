// Reads UnixFS files back out of blocks: the bytes import_blob took in, not
// the root block. Links are followed depth-first in order, which is file order
// in every UnixFS layout; data on a dag-pb node precedes its links. A node's
// blockSizes place its children in the file, so a range read visits only the
// blocks that cover it. Every child must hold exactly the bytes its parent
// declares, so a file's size, read from its root alone, is the length of what
// a full read yields.
import { decode as decode_dag_pb, code as DAG_PB_CODE } from '@ipld/dag-pb';
import { UnixFS } from 'ipfs-unixfs';
import { code as RAW_CODE } from 'multiformats/codecs/raw';
import { ProtocolError } from '#types/errors.ts';
import { collect_bytes, format_cid, parse_content_cid } from "./block.js";
const FILE_TYPES = new Set(['file', 'raw']);
const invalid_shape = (cid, reason) => new ProtocolError('invalid_shape', `${reason}: ${format_cid(cid)}`);
const parse_file_node = (cid, bytes) => {
    if (cid.code === RAW_CODE)
        return { cid, size: bytes.length, data: bytes, children: [] };
    if (cid.code !== DAG_PB_CODE)
        throw invalid_shape(cid, 'not a UnixFS block');
    const { Data, Links } = decode_dag_pb(bytes);
    const unixfs = Data === undefined ? undefined : UnixFS.unmarshal(Data);
    if (unixfs === undefined || !FILE_TYPES.has(unixfs.type))
        throw invalid_shape(cid, 'not a UnixFS file');
    if (Links.length !== unixfs.blockSizes.length)
        throw invalid_shape(cid, `${Links.length} links but ${unixfs.blockSizes.length} block sizes`);
    return {
        cid,
        // ipfs-unixfs sums data and blockSizes; the encoded filesize is not read.
        size: Number(unixfs.fileSize()),
        data: unixfs.data ?? new Uint8Array(0),
        children: Links.map(({ Hash }, index) => ({ cid: parse_content_cid(Hash.toString()), size: Number(unixfs.blockSizes[index]) }))
    };
};
const parse_child = (child, bytes) => {
    const node = parse_file_node(child.cid, bytes);
    if (node.size !== child.size)
        throw invalid_shape(child.cid, `holds ${node.size} bytes where its parent declares ${child.size}`);
    return node;
};
const read_child = async (read, child) => {
    const bytes = await read(format_cid(child.cid));
    if (bytes === undefined)
        throw new ProtocolError('content_unavailable', `block not stored: ${format_cid(child.cid)}`);
    return parse_child(child, bytes);
};
// Offsets are relative to the node and may fall outside it; only the overlap is yielded.
async function* read_node_range({ read, node, start_offset, end_offset }) {
    if (start_offset < node.data.length && end_offset >= 0) {
        yield node.data.subarray(Math.max(start_offset, 0), Math.min(end_offset + 1, node.data.length));
    }
    let offset = node.data.length;
    for (const child of node.children) {
        if (offset > end_offset)
            return;
        if (child.size > 0 && offset + child.size > start_offset) {
            yield* read_node_range({ read, node: await read_child(read, child), start_offset: start_offset - offset, end_offset: end_offset - offset });
        }
        offset += child.size;
    }
}
// Whether every block under the node is stored, empty ones included. Inner
// nodes are read; raw leaves are read too, or with has only asked about.
const holds_every_block = async ({ read, has, node }) => {
    for (const child of node.children) {
        if (has !== undefined && child.cid.code === RAW_CODE) {
            if (!(await has(format_cid(child.cid))))
                return false;
            continue;
        }
        const bytes = await read(format_cid(child.cid));
        if (bytes === undefined)
            return false;
        if (!(await holds_every_block({ read, has, node: parse_child(child, bytes) })))
            return false;
    }
    return true;
};
const holds_unixfs_file = async ({ cid, read, has }) => {
    const root_cid = parse_content_cid(cid);
    const root_bytes = await read(format_cid(root_cid));
    return root_bytes !== undefined && await holds_every_block({ read, has, node: parse_file_node(root_cid, root_bytes) });
};
// Undefined when the root is not stored; rejects with invalid_shape when the
// root is no UnixFS file and, with max_bytes, with size_exceeded when its
// declared size is over it, before any other block is read.
export const open_unixfs_file = async ({ cid, read, max_bytes = Infinity }) => {
    const root_cid = parse_content_cid(cid);
    const root_bytes = await read(format_cid(root_cid));
    if (root_bytes === undefined)
        return undefined;
    const root = parse_file_node(root_cid, root_bytes);
    if (root.size > max_bytes)
        throw new ProtocolError('size_exceeded', `file over ${max_bytes} bytes: ${cid}`);
    return {
        file_size: root.size,
        read_range: ({ start_offset, end_offset }) => {
            if (!(Number.isSafeInteger(start_offset) && Number.isSafeInteger(end_offset) && start_offset >= 0 && start_offset <= end_offset && end_offset < root.size)) {
                throw new RangeError(`no range ${start_offset}-${end_offset} in a file of ${root.size} bytes`);
            }
            return read_node_range({ read, node: root, start_offset, end_offset });
        }
    };
};
// The whole file; undefined when the root is not stored. Rejects as
// open_unixfs_file and read_range do. Child sizes are checked against their
// parents, so the bytes read never pass the root's size and max_bytes.
export const read_unixfs_file = async ({ cid, read, max_bytes }) => {
    const file = await open_unixfs_file({ cid, read, max_bytes });
    if (file === undefined)
        return undefined;
    if (file.file_size === 0)
        return new Uint8Array(0);
    return await collect_bytes(file.read_range({ start_offset: 0, end_offset: file.file_size - 1 }));
};
// Reads every block of the file and keeps none of its bytes, as a fetch that
// only needs the blocks stored does. False when any block is not stored;
// rejects with invalid_shape when the file is malformed.
export const visit_unixfs_file = async ({ cid, read }) => await holds_unixfs_file({ cid, read });
// Whether every block of the file is stored, reading the root and inner
// nodes but asking has of the raw leaves, so a check never reads the audio
// back. Rejects with invalid_shape when the file is malformed.
export const has_unixfs_file = async ({ cid, read, has }) => await holds_unixfs_file({ cid, read, has });
