// The clock and timers the replication engine schedules with, injectable so
// tests drive rate limits and coalescing without waiting on the wall clock.

export interface Timers {
  now: () => number
  set_timeout: (job: () => void, delay_ms: number) => unknown
  clear_timeout: (handle: unknown) => void
}

export const SYSTEM_TIMERS: Timers = Object.freeze({
  now: () => Date.now(),
  set_timeout: (job: () => void, delay_ms: number) => setTimeout(job, delay_ms),
  clear_timeout: (handle: unknown) => { clearTimeout(handle as ReturnType<typeof setTimeout>) }
})
