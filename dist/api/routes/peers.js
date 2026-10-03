import { Router } from 'express';
export const peers_router = (peer) => {
    const router = Router();
    router.get('/', async (_req, res) => { res.json(await peer.list_peers()); });
    return router;
};
