import { Router } from 'express';
import { fileTypeFromBuffer } from 'file-type';
import { ProtocolError } from '#types/errors.ts';
import { ApiError } from "../middleware.js";
const MIME_SNIFF_BYTES = 4100;
// A CID never names other bytes, so a client keeps what it fetched.
const IMMUTABLE = 'private, max-age=31536000, immutable';
// The blob and its sniffed type, or undefined when it is absent, over the
// cap, not an image, or the string is not a CID. Only image/* is served, so
// the route is no generic blob fetch.
const read_image = async (peer, cid, local_only) => {
    let bytes;
    try {
        bytes = await peer.get_image(cid, { local_only });
    }
    catch (error) {
        if (error instanceof ProtocolError && error.code === 'invalid_cid')
            return undefined;
        throw error;
    }
    if (bytes === undefined)
        return undefined;
    const type = await fileTypeFromBuffer(bytes.subarray(0, MIME_SNIFF_BYTES));
    return type?.mime.startsWith('image/') === true ? { bytes, mime: type.mime } : undefined;
};
export const images_router = (peer) => {
    const router = Router();
    router.head('/:cid', async (req, res) => {
        res.status(await read_image(peer, req.params.cid, true) === undefined ? 404 : 200).end();
    });
    router.get('/:cid', async (req, res) => {
        const image = await read_image(peer, req.params.cid, false);
        if (image === undefined) {
            throw new ApiError({ status: 404, code: 'NOT_FOUND', message: `no image locally or from peers: ${req.params.cid}` });
        }
        res.setHeader('Content-Type', image.mime);
        res.setHeader('Content-Length', image.bytes.length);
        res.setHeader('Cache-Control', IMMUTABLE);
        res.status(200).end(image.bytes);
    });
    return router;
};
