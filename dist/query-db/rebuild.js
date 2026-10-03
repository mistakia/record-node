// Full rebuild of the query index by replay (§4.7): drop every table, merge
// each library's stored entry blocks into a fresh oplog, and project the
// result. Rebuild and incremental maintenance share the projector, and the
// rows they produce are the same.
import { create_oplog } from '#oplog/dag.ts';
import { merge_entries } from '#oplog/merge.ts';
import { create_projector } from "./projector.js";
import { apply_schema, drop_schema } from "./schema.js";
export const rebuild_query_db = async ({ db, libraries, read_content }) => {
    drop_schema(db);
    apply_schema(db);
    const projector = create_projector({ db, read_content });
    const oplogs = [];
    const rejected = [];
    for (const { chain, blocks } of libraries) {
        const oplog = create_oplog({ chain });
        rejected.push(...merge_entries({ oplog, blocks: [...blocks] }).rejected);
        await projector.project_library({ oplog });
        oplogs.push(oplog);
    }
    return { oplogs, rejected };
};
