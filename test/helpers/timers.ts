// Timers driven by hand: jobs run only when advance() passes their due time,
// so rate limits and coalescing are asserted without waiting.

import type { Timers } from '#replication/timers.ts'

export const create_manual_timers = (start_ms = 1_000_000): Timers & { advance: (ms: number) => void, pending: () => number } => {
  let now = start_ms
  let next_id = 0
  const jobs = new Map<number, { due: number, job: () => void }>()
  const run_due = () => {
    for (;;) {
      const due = [...jobs].filter(([, { due }]) => due <= now).sort(([a, x], [b, y]) => x.due - y.due || a - b)[0]
      if (due === undefined) return
      jobs.delete(due[0])
      due[1].job()
    }
  }
  return {
    now: () => now,
    set_timeout: (job, delay_ms) => {
      const id = next_id++
      jobs.set(id, { due: now + delay_ms, job })
      return id
    },
    clear_timeout: (handle) => { jobs.delete(handle as number) },
    advance: (ms) => {
      now += ms
      run_due()
    },
    pending: () => jobs.size
  }
}
