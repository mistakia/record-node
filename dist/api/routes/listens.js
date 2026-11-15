import { Router } from 'express';
import { ApiError } from "../middleware.js";
import { page } from "./query.js";
// How far a client's listened_at_ms may sit from the node's clock (chapter 7).
export const LISTEN_FUTURE_SKEW_WINDOW_MS = 5 * 60 * 1000;
export const LISTEN_PAST_ACCEPTANCE_WINDOW_MS = 90 * 24 * 60 * 60 * 1000;
const check_listened_at = (listened_at_ms) => {
    const now = Date.now();
    if (listened_at_ms <= now + LISTEN_FUTURE_SKEW_WINDOW_MS && listened_at_ms >= now - LISTEN_PAST_ACCEPTANCE_WINDOW_MS)
        return;
    throw new ApiError({
        status: 400,
        code: 'VALIDATION_ERROR',
        message: 'listened_at_ms is outside the window this node accepts',
        details: [{
                field: 'listened_at_ms',
                message: `more than ${LISTEN_FUTURE_SKEW_WINDOW_MS / 60_000} minutes ahead of the node or more than ${LISTEN_PAST_ACCEPTANCE_WINDOW_MS / 86_400_000} days behind it`
            }]
    });
};
export const listens_router = (peer) => {
    const router = Router();
    router.get('/', async (req, res) => {
        res.json(await peer.list_listens(page(req)));
    });
    // The validator enforces the shape, including client_listen_id requiring
    // listened_at_ms; the peer assigns the timestamp when none is given (§6.5).
    router.post('/', async (req, res) => {
        const { track_id, library_address, listened_at_ms, client_listen_id } = req.body;
        if (listened_at_ms !== undefined)
            check_listened_at(listened_at_ms);
        res.json(await peer.record_listen({
            track_id,
            library_address,
            ...(listened_at_ms === undefined ? {} : { listened_at_ms }),
            ...(client_listen_id === undefined ? {} : { client_listen_id })
        }));
    });
    return router;
};
