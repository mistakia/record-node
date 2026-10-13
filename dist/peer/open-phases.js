// Phase timings for slow startup work (a library open, its re-pin pass), so a
// restart that takes minutes says where they went. A run under REPORT_MS stays
// silent, which keeps small libraries and tests quiet.
const REPORT_MS = 1000;
export const open_phases = () => {
    const started = performance.now();
    const durations = [];
    const record = (phase, since) => { durations.push([phase, performance.now() - since]); };
    return {
        time: (phase, fn) => {
            const since = performance.now();
            try {
                return fn();
            }
            finally {
                record(phase, since);
            }
        },
        time_async: async (phase, fn) => {
            const since = performance.now();
            try {
                return await fn();
            }
            finally {
                record(phase, since);
            }
        },
        report: (subject) => {
            const total = performance.now() - started;
            if (total < REPORT_MS)
                return;
            const parts = durations.map(([phase, ms]) => `${phase} ${(ms / 1000).toFixed(1)} s`);
            console.log(`${subject} in ${(total / 1000).toFixed(1)} s (${parts.join(', ')})`);
        }
    };
};
