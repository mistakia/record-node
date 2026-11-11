import { Router } from 'express';
import { fileTypeFromBuffer } from 'file-type';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { collect_bytes } from '#fabric/block.ts';
import { ProtocolError } from '#types/errors.ts';
import { ApiError } from "../middleware.js";
const MIME_SNIFF_BYTES = 4100;
// A string that is not a CID names nothing in the store.
const absent_on_invalid_cid = async (lookup, fallback) => {
    try {
        return await lookup;
    }
    catch (error) {
        if (error instanceof ProtocolError && error.code === 'invalid_cid')
            return fallback;
        throw error;
    }
};
const not_found = (cid) => new ApiError({ status: 404, code: 'NOT_FOUND', message: `not available locally or from peers: ${cid}` });
// Before the headers go out a block that cannot be read still makes the blob
// unavailable, the same 404 as a missing root, never the 400 a ProtocolError
// otherwise maps to.
const not_found_when_unreadable = async (cid, read) => {
    try {
        return await read();
    }
    catch (error) {
        if (error instanceof ProtocolError)
            throw not_found(cid);
        throw error;
    }
};
const sniff_mime = async ({ cid, file }) => {
    if (file.file_size === 0)
        return undefined;
    const head = await not_found_when_unreadable(cid, async () => await collect_bytes(file.read_range({ start_offset: 0, end_offset: Math.min(MIME_SNIFF_BYTES, file.file_size) - 1 })));
    return (await fileTypeFromBuffer(head))?.mime;
};
// The body streams after the headers, so a failure can no longer change the
// status: pipeline destroys the response, and the client sees a transfer cut
// short of its Content-Length. A client hanging up is routine (a player
// cancels its range on every seek) and ends the stream silently.
const stream_body = async ({ res, chunks, log_error }) => {
    try {
        await pipeline(Readable.from(chunks, { objectMode: false }), res);
    }
    catch (error) {
        if (error.code !== 'ERR_STREAM_PREMATURE_CLOSE')
            log_error(error);
    }
};
const send_audio = async ({ req, res, cid, file, log_error }) => {
    const size = file.file_size;
    res.setHeader('Accept-Ranges', 'bytes');
    // A malformed or multi-range header is ignored and the whole blob served
    // (RFC 7233 §3.1); an unsatisfiable one is answered 416.
    const ranges = req.headers.range === undefined ? undefined : req.range(size, { combine: true });
    if (ranges === -1) {
        res.setHeader('Content-Range', `bytes */${size}`);
        res.status(416).end();
        return;
    }
    const range = Array.isArray(ranges) && ranges.length === 1 && ranges.type === 'bytes' ? ranges[0] : undefined;
    res.setHeader('Content-Type', await sniff_mime({ cid, file }) ?? 'application/octet-stream');
    if (size === 0) {
        res.setHeader('Content-Length', 0);
        res.status(200).end();
        return;
    }
    const start_offset = range?.start ?? 0;
    const end_offset = range?.end ?? size - 1;
    // The first covering block is read before the status goes out, so a range
    // whose first block is unavailable is a 404, not a reset connection.
    const chunks = file.read_range({ start_offset, end_offset })[Symbol.asyncIterator]();
    const first = await not_found_when_unreadable(cid, async () => await chunks.next());
    res.setHeader('Content-Length', end_offset - start_offset + 1);
    if (range !== undefined)
        res.setHeader('Content-Range', `bytes ${start_offset}-${end_offset}/${size}`);
    res.status(range === undefined ? 200 : 206);
    await stream_body({
        res,
        chunks: (async function* () {
            if (first.done !== true)
                yield first.value;
            yield* { [Symbol.asyncIterator]: () => chunks };
        })(),
        log_error
    });
};
export const audio_router = (peer, log_error) => {
    const router = Router();
    router.head('/:cid', async (req, res) => {
        res.status(await absent_on_invalid_cid(peer.has_audio(req.params.cid), false) ? 200 : 404).end();
    });
    router.get('/:cid', async (req, res) => {
        const closed = new AbortController();
        res.once('close', () => { closed.abort(); });
        const file = await absent_on_invalid_cid(peer.open_audio(req.params.cid, { closed: closed.signal }), undefined);
        if (file === undefined)
            throw not_found(req.params.cid);
        await send_audio({ req, res, cid: req.params.cid, file, log_error });
    });
    return router;
};
