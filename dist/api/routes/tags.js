import { Router } from 'express';
import { query_list, query_value } from "./query.js";
export const tags_router = (peer) => {
    const router = Router();
    router.get('/', async (req, res) => {
        const library_addresses = query_list(req, 'library_addresses');
        const prefix = query_value(req, 'prefix');
        res.json(await peer.list_tags({
            ...(library_addresses === undefined ? {} : { library_addresses }),
            ...(prefix === undefined ? {} : { prefix })
        }));
    });
    router.post('/batch', async (req, res) => {
        const { items, library_address, capability_id } = req.body;
        res.json({ results: await peer.change_labels_batch({ items, library_address, capability_id }) });
    });
    router.post('/', async (req, res) => {
        const { track_id, tag, library_address, capability_id } = req.body;
        res.json(await peer.add_tag({ track_id, tag, library_address, capability_id }));
    });
    router.delete('/', async (req, res) => {
        res.json(await peer.remove_tag({
            track_id: query_value(req, 'track_id') ?? '',
            tag: query_value(req, 'tag') ?? '',
            library_address: query_value(req, 'library_address'),
            capability_id: query_value(req, 'capability_id')
        }));
    });
    return router;
};
