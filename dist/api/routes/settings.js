import { Router } from 'express';
export const settings_router = (peer) => {
    const router = Router();
    router.get('/', async (_req, res) => { res.json(await peer.get_settings()); });
    return router;
};
