import { Router } from 'express';
import { ApiError } from "../middleware.js";
import { query_value } from "./query.js";
const STRING_FIELDS = ['fulltitle', 'thumbnail', 'artist', 'alt_title', 'upload_date', 'webpage_url'];
// Project raw resolver output onto the API ResolverEntry (§2.4.2). Fields are
// enumerated, so a streaming url never crosses the API boundary, and a record
// without a string (extractor, id) is refused: that pair is the source
// pointer's identity.
export const to_resolver_entry = (record) => {
    const { extractor, id, duration } = record;
    if (typeof extractor !== 'string' || extractor === '' || typeof id !== 'string' || id === '') {
        throw new ApiError({ status: 500, code: 'INTERNAL_ERROR', message: 'resolver returned a record without (extractor, id)' });
    }
    const entry = { extractor, id };
    for (const field of STRING_FIELDS) {
        const value = record[field];
        if (typeof value === 'string')
            entry[field] = value;
    }
    if (typeof duration === 'number')
        entry.duration = duration;
    return entry;
};
export const resolve_router = (resolve) => {
    const router = Router();
    // A URL that expands to several sources (a playlist) previews its first.
    router.get('/', async (req, res) => {
        const url = query_value(req, 'url') ?? '';
        const [first] = await resolve(url);
        if (first === undefined) {
            throw new ApiError({ status: 400, code: 'VALIDATION_ERROR', message: `no source found at ${url}`, details: [{ field: 'url', message: 'resolved to no source' }] });
        }
        res.json(to_resolver_entry(first));
    });
    return router;
};
