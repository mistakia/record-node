import { rm } from 'node:fs/promises';
import { Router } from 'express';
const optional_string = (value) => typeof value === 'string' && value !== '' ? value : undefined;
export const import_router = (peer) => {
    const router = Router();
    // Request validation has already buffered the upload to disk. Ingest owns
    // the temp files once it accepts them; until then they are ours to remove.
    router.post('/file', async (req, res) => {
        const paths = req.files.map((file) => file.path);
        try {
            res.status(202).json(await peer.import_files({
                paths,
                library_address: optional_string(req.body.library_address),
                capability_id: optional_string(req.body.capability_id)
            }));
        }
        catch (error) {
            await Promise.all(paths.map(async (path) => await rm(path, { force: true })));
            throw error;
        }
    });
    router.post('/url', async (req, res) => {
        const { url, library_address, capability_id } = req.body;
        res.status(202).json(await peer.import_url({ url, library_address, capability_id }));
    });
    return router;
};
