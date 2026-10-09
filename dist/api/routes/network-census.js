// GET /network-census?date=YYYY-MM-DD: one UTC day's census row, today's in
// progress by default. Implementation-only: not in chapter 7, so it is
// mounted ahead of the spec validator, behind the same authentication.
import { Router } from 'express';
import { ApiError } from "../middleware.js";
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
export const network_census_router = (peer) => {
    const router = Router();
    router.get('/', async (req, res) => {
        const { date } = req.query;
        if (date !== undefined && (typeof date !== 'string' || !DATE_PATTERN.test(date))) {
            throw new ApiError({ status: 400, code: 'VALIDATION_ERROR', message: 'date must be YYYY-MM-DD' });
        }
        const row = await peer.get_network_census(date);
        if (row === undefined)
            throw new ApiError({ status: 404, code: 'NOT_FOUND', message: `no census row for ${date ?? 'today'}` });
        res.json(row);
    });
    return router;
};
