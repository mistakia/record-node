const { startRecord, createTrack } = require('../../test/utils')

const base = {
  prepare: async function () {
    const { record } = await startRecord('0')

    process.stdout.clearLine()
    for (let i = 1; i < this.count + 1; i++) {
      process.stdout.write(`\r${this.name} - Preparing - Writing: ${i}/${this.count}`)
      await record.tracks.add(createTrack(`Hello${i}`))
    }

    return { record }
  },
  cycle: async function ({ record }, { count }) {
    await record.tracks.list({ addresses: [record.address] })
  },
  teardown: async function ({ record }) {
    await record.stop()
  }
}

const baseline = {
  while: ({ stats, startTime, baselineLimit }) => {
    return stats.count < baselineLimit
  }
}

const stress = {
  while: ({ stats, startTime, stressLimit }) => {
    return process.hrtime(startTime)[0] < stressLimit
  }
}

const counts = [100, 500, 1000]
const benchmarks = []
for (const count of counts) {
  const c = { count }
  benchmarks.push({ name: `list-tracks-${count}-baseline`, ...base, ...c, ...baseline })
  benchmarks.push({ name: `list-tracks-${count}-stress`, ...base, ...c, ...stress })
}

module.exports = benchmarks
