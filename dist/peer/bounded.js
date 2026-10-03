// Runs jobs with at most `limit` in flight.
export const run_bounded = async (items, limit, job) => {
    const queue = [...items];
    const worker = async () => {
        for (let item = queue.shift(); item !== undefined; item = queue.shift())
            await job(item);
    };
    await Promise.all(Array.from({ length: Math.min(limit, queue.length) }, worker));
};
