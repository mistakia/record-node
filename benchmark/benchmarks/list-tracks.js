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
    await record.tracks.list()
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

module.exports = [
  { name: 'list-tracks-baseline', ...base, ...baseline },
  { name: 'list-tracks-stress', ...base, ...stress }
]
