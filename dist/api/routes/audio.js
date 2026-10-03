import { Router } from 'express';
import { fileTypeFromBuffer } from 'file-type';
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
const send_audio = async (req, res, bytes) => {
    const type = await fileTypeFromBuffer(bytes.subarray(0, MIME_SNIFF_BYTES));
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Content-Type', type?.mime ?? 'application/octet-stream');
    // A malformed or multi-range header is ignored and the whole blob served
    // (RFC 7233 §3.1); an unsatisfiable one is answered 416.
    const ranges = req.headers.range === undefined ? undefined : req.range(bytes.length, { combine: true });
    if (ranges === -1) {
        res.setHeader('Content-Range', `bytes */${bytes.length}`);
        res.status(416).end();
        return;
    }
    const range = Array.isArray(ranges) && ranges.length === 1 && ranges.type === 'bytes' ? ranges[0] : undefined;
    if (range === undefined) {
        res.setHeader('Content-Length', bytes.length);
        res.status(200).end(bytes);
        return;
    }
    const slice = bytes.subarray(range.start, range.end + 1);
    res.setHeader('Content-Range', `bytes ${range.start}-${range.end}/${bytes.length}`);
    res.setHeader('Content-Length', slice.length);
    res.status(206).end(slice);
};
export const audio_router = (peer) => {
    const router = Router();
    router.head('/:cid', async (req, res) => {
        res.status(await absent_on_invalid_cid(peer.has_audio(req.params.cid), false) ? 200 : 404).end();
    });
    router.get('/:cid', async (req, res) => {
        const bytes = await absent_on_invalid_cid(peer.get_audio(req.params.cid), undefined);
        if (bytes === undefined) {
            throw new ApiError({ status: 404, code: 'NOT_FOUND', message: `not available locally or from peers: ${req.params.cid}` });
        }
        await send_audio(req, res, bytes);
    });
    return router;
};
