const { startRecord, createTrack } = require('../../test/utils')

const base = {
  prepare: async function () {
    return startRecord('0')
  },
  cycle: async function ({ record }, { count }) {
    await record.tracks.add(createTrack(`Hello${count}`))
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
  { name: 'add-tracks-baseline', ...base, ...baseline },
  { name: 'add-tracks-stress', ...base, ...stress }
]
