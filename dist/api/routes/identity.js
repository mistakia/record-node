import { Router } from 'express';
export const identity_router = (peer) => {
    const router = Router();
    router.get('/export', async (_req, res) => {
        res.json(await peer.export_identity());
    });
    // The body is optional; without a private_key the peer generates one.
    router.post('/import', async (req, res) => {
        const private_key = req.body?.private_key;
        res.json(await peer.import_identity(typeof private_key === 'string' ? { private_key } : {}));
    });
    return router;
};
