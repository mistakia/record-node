// The network census: aggregate counts of the peers a node sees, one row per
// UTC day, for measuring the network's growth. Implementation-only, outside
// the spec.
//
// What it never stores: an address, a raw peer id, or which peer announced
// which library. Peer ids are held in memory only, as HMACs under a key drawn
// at random each week and dropped at the week's end, in one set for the
// current UTC day and one for the current week (Monday to Sunday UTC). A row
// holds only counts. A restart undercounts the day and week in progress.
//
// The counts are lower bounds on the network: the census sees only peers that
// connect to this node or announce on RECORD.
import { createHmac, randomBytes } from 'node:crypto';
import { appendFile, mkdir, readdir, readFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
export const SYSTEM_CENSUS_TIMERS = Object.freeze({
    now: () => Date.now(),
    set_interval: (job, interval_ms) => {
        const handle = setInterval(job, interval_ms);
        handle.unref();
        return handle;
    },
    clear_interval: (handle) => { clearInterval(handle); }
});
export const SAMPLE_INTERVAL_MS = 5 * 60_000;
export const RETENTION_DAYS = 90;
// A version held by fewer peers than this is counted under `other`.
export const VERSION_BUCKET_FLOOR = 3;
const DAY_MS = 24 * 60 * 60_000;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const AGENT_PATTERN = /^record-node\/(\d{1,3}\.\d{1,3}) \((public|masked|relayed)\)$/;
// At most this many named version buckets; the rest count under `other`.
export const VERSION_BUCKET_LIMIT = 16;
const RENDEZVOUS_LOOKUP_TIMEOUT_MS = 120_000;
export const utc_date = (ms) => new Date(ms).toISOString().slice(0, 10);
// The Monday that starts ms's week.
export const week_start = (ms) => {
    const day = new Date(ms).getUTCDay();
    return utc_date(ms - ((day + 6) % 7) * DAY_MS);
};
// The agent string's version and mode (§5.6.4), or `other` and none for any
// string not of that exact form, so a peer cannot write free text into a row.
export const parse_agent = (agent) => {
    const match = AGENT_PATTERN.exec(agent ?? '');
    return match === null ? { version: 'other', mode: undefined } : { version: `record-node/${match[1]}`, mode: match[2] };
};
const median = (values) => {
    if (values.length === 0)
        return 0;
    const sorted = [...values].sort((left, right) => left - right);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 1 ? sorted[middle] : Math.round((sorted[middle - 1] + sorted[middle]) / 2);
};
const bucket_versions = (versions) => {
    const counts = new Map();
    for (const version of versions)
        counts.set(version, (counts.get(version) ?? 0) + 1);
    // The most-held versions keep their names.
    const named = new Set([...counts]
        .filter(([version, count]) => version !== 'other' && count >= VERSION_BUCKET_FLOOR)
        .sort(([left_version, left], [right_version, right]) => right - left || left_version.localeCompare(right_version))
        .slice(0, VERSION_BUCKET_LIMIT)
        .map(([version]) => version));
    const buckets = {};
    for (const [version, count] of [...counts].sort(([left], [right]) => left.localeCompare(right))) {
        const bucket = named.has(version) ? version : 'other';
        buckets[bucket] = (buckets[bucket] ?? 0) + count;
    }
    return buckets;
};
const new_day = (date) => ({ date, peers: new Set(), agents: new Map(), libraries: new Set(), samples: [] });
const new_week = (start) => ({ start, key: randomBytes(32), peers: new Set() });
export const create_census = ({ dir, observations, timers = SYSTEM_CENSUS_TIMERS }) => {
    let day = new_day(utc_date(timers.now()));
    let week = new_week(week_start(timers.now()));
    let writes = Promise.resolve();
    let interval;
    const unsubscribes = [];
    const hash = (value) => createHmac('sha256', week.key).update(value).digest('base64url');
    const row_of = (state, complete) => {
        const versions = [...state.peers].map((peer) => state.agents.get(peer)?.version ?? 'other');
        return {
            date: state.date,
            complete,
            distinct_peer_count: state.peers.size,
            peak_connection_count: Math.max(0, ...state.samples),
            median_connection_count: median(state.samples),
            masked_peer_count: [...state.agents.values()].filter(({ mode }) => mode === 'masked').length,
            announced_library_count: state.libraries.size,
            node_version_counts: bucket_versions(versions)
        };
    };
    const append_row = async (row) => {
        await appendFile(join(dir, `${row.date}.jsonl`), `${JSON.stringify(row)}\n`);
    };
    // Writes run one at a time, in order.
    const queue_write = (job) => {
        writes = writes.then(job).catch((error) => { process.emitWarning(`census write failed: ${error.message}`); });
        return writes;
    };
    const prune = async () => {
        const oldest = utc_date(timers.now() - RETENTION_DAYS * DAY_MS);
        for (const name of await readdir(dir)) {
            const date = name.replace(/\.jsonl$/, '');
            if (DATE_PATTERN.test(date) && name.endsWith('.jsonl') && date < oldest)
                await unlink(join(dir, name));
        }
    };
    // Closes the day, and the week with it on a Sunday, when the clock has
    // passed them. The rendezvous lookup runs as the day closes.
    const roll = () => {
        const now = timers.now();
        const today = utc_date(now);
        if (today === day.date)
            return;
        const ended = day;
        const week_ended = week_start(now) !== week.start;
        const weekly = week_ended ? week.peers.size : undefined;
        day = new_day(today);
        if (week_ended)
            week = new_week(week_start(now));
        const base = row_of(ended, true);
        queue_write(async () => {
            // A lookup that never answers must not hold every later write.
            const timeout = new Promise((resolve) => { setTimeout(() => { resolve(null); }, RENDEZVOUS_LOOKUP_TIMEOUT_MS).unref(); });
            const rendezvous_address_count = await Promise.race([observations.count_rendezvous_addresses().catch(() => null), timeout]);
            await append_row({ ...base, rendezvous_address_count, ...(weekly === undefined ? {} : { weekly_distinct_peer_count: weekly }) });
            await prune();
        });
    };
    const tick = async () => {
        roll();
        day.samples.push(observations.connected_peer_count());
        await writes;
    };
    const read_row = async (date = utc_date(timers.now())) => {
        if (!DATE_PATTERN.test(date))
            throw new RangeError(`date must be YYYY-MM-DD, not ${date}`);
        roll();
        if (date === day.date)
            return { ...row_of(day, false), rendezvous_address_count: null };
        await writes;
        let text;
        try {
            text = await readFile(join(dir, `${date}.jsonl`), 'utf8');
        }
        catch (error) {
            if (error.code === 'ENOENT')
                return undefined;
            throw error;
        }
        const rows = text.split('\n').filter((line) => line !== '').map((line) => JSON.parse(line));
        return rows.findLast(({ complete }) => complete) ?? rows.at(-1);
    };
    return {
        start: async () => {
            await mkdir(dir, { recursive: true });
            await prune();
            unsubscribes.push(observations.on_connection_open((peer_id) => {
                roll();
                const peer = hash(peer_id);
                day.peers.add(peer);
                week.peers.add(peer);
            }), observations.on_peer_identify((peer_id, agent) => {
                roll();
                const peer = hash(peer_id);
                day.peers.add(peer);
                week.peers.add(peer);
                day.agents.set(peer, parse_agent(agent));
            }), observations.on_library_announced((library_address) => {
                roll();
                day.libraries.add(hash(library_address));
            }));
            day.samples.push(observations.connected_peer_count());
            interval = timers.set_interval(() => { tick().catch(() => { }); }, SAMPLE_INTERVAL_MS);
        },
        stop: async () => {
            timers.clear_interval(interval);
            for (const unsubscribe of unsubscribes.splice(0))
                unsubscribe();
            roll();
            const partial = { ...row_of(day, false), rendezvous_address_count: null };
            await queue_write(async () => { await append_row(partial); });
        },
        read_row,
        tick
    };
};
