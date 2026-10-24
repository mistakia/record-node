import { Router } from 'express';
import { assert_label_writer } from "../middleware.js";
import { page, query_list, query_value } from "./query.js";
export const tracks_router = (peer, managed) => {
    const router = Router();
    router.get('/', async (req, res) => {
        const library_addresses = query_list(req, 'library_addresses');
        const label_libraries = query_list(req, 'label_libraries');
        const tags = query_list(req, 'tags');
        const tag_groups = query_value(req, 'tag_groups');
        const query = query_value(req, 'query');
        res.json(await peer.list_tracks({
            ...page(req),
            ...(library_addresses === undefined ? {} : { library_addresses }),
            ...(label_libraries === undefined ? {} : { label_libraries }),
            ...(tags === undefined ? {} : { tags }),
            ...(tag_groups === undefined ? {} : { tag_groups }),
            ...(query === undefined ? {} : { query }),
            shuffle: query_value(req, 'shuffle') ?? false,
            sort: query_value(req, 'sort') ?? 'added_at',
            order: query_value(req, 'order') ?? 'desc'
        }));
    });
    router.post('/', async (req, res) => {
        const { content_cid, tags, library_address, capability_id } = req.body;
        if (tags !== undefined)
            assert_label_writer(managed, res, library_address);
        res.json(await peer.add_track({ content_cid, tags, library_address, capability_id }));
    });
    router.patch('/:id', async (req, res) => {
        const { tags, library_address, capability_id } = req.body;
        res.json(await peer.update_track({ track_id: req.params.id, tags, library_address, capability_id }));
    });
    router.patch('/:id/tags', async (req, res) => {
        const { add, remove, set, library_address, capability_id } = req.body;
        assert_label_writer(managed, res, library_address);
        res.json(await peer.change_labels({ track_id: req.params.id, add, remove, set, library_address, capability_id }));
    });
    router.post('/:id/rederive', async (req, res) => {
        const { library_address, capability_id } = req.body ?? {};
        res.json(await peer.rederive_track({ track_id: req.params.id, library_address, capability_id }));
    });
    router.delete('/:id', async (req, res) => {
        await peer.remove_track({ track_id: req.params.id, library_address: query_value(req, 'library_address') });
        res.status(204).end();
    });
    router.post('/:cid/pin', async (req, res) => {
        await peer.pin_track(req.params.cid);
        res.status(204).end();
    });
    router.delete('/:cid/pin', async (req, res) => {
        await peer.unpin_track(req.params.cid);
        res.status(204).end();
    });
    return router;
};
