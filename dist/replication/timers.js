// The clock and timers the replication engine schedules with, injectable so
// tests drive rate limits and coalescing without waiting on the wall clock.
export const SYSTEM_TIMERS = Object.freeze({
    now: () => Date.now(),
    set_timeout: (job, delay_ms) => setTimeout(job, delay_ms),
    clear_timeout: (handle) => { clearTimeout(handle); }
});
