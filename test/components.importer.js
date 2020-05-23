/* global describe it beforeEach afterEach */

const assert = require('assert')
const path = require('path')
const {
  config,
  startRecord
} = require('./utils')

describe('record', function () {
  this.timeout(config.timeout)
  let record

  beforeEach(async () => {
    try {
      ({ record } = await startRecord('0'))
    } catch (error) {
      console.log(error)
    }
  })
  afterEach(async () => record && record.stop())

  describe('components.importer', function () {
    const filepath = path.join(__dirname, 'fixtures/tracks/Dj Falcon And Thomas Bangalter - So Much Love To Give(Original Mix).mp3')
    const dirpath = path.join(__dirname, 'fixtures/tracks/')
    const startImporter = (filepath) => new Promise((resolve, reject) => {
      const events = []
      record.on('redux', ({ type, payload }) => {
        switch (type) {
          case 'IMPORTER_FINISHED':
            events.push({ type, payload })
            return resolve(events)

          case 'IMPORTER_PROCESSED_FILE':
            return events.push({ type, payload })
        }
      })
      record.importer.add(filepath)
    })

    it('add file', async () => {
      const events = await startImporter(filepath)

      const processedEvents = events.filter(e => e.type === 'IMPORTER_PROCESSED_FILE')
      const finishedEvents = events.filter(e => e.type === 'IMPORTER_FINISHED')
      assert.strictEqual(events.length, 2)
      assert.strictEqual(processedEvents.length, 1)
      assert.strictEqual(finishedEvents.length, 1)

      assert.strictEqual(processedEvents[0].payload.completed, 1)
      assert.strictEqual(processedEvents[0].payload.remaining, 0)
      assert.notStrictEqual(processedEvents[0].payload.trackId, undefined)

      const tracks = await record.tracks.list({ addresses: [record.address] })

      assert.strictEqual(tracks.length, 1)
      assert.strictEqual(processedEvents[0].payload.trackId, tracks[0].id)
    })

    it('add directory', async () => {
      const events = await startImporter(dirpath)

      const processedEvents = events.filter(e => e.type === 'IMPORTER_PROCESSED_FILE')
      const finishedEvents = events.filter(e => e.type === 'IMPORTER_FINISHED')
      assert.strictEqual(events.length, 3)
      assert.strictEqual(processedEvents.length, 2)
      assert.strictEqual(finishedEvents.length, 1)

      assert.strictEqual(processedEvents[0].payload.completed, 1)
      assert.strictEqual(processedEvents[0].payload.remaining, 1)
      assert.notStrictEqual(processedEvents[0].payload.trackId, undefined)

      assert.strictEqual(processedEvents[1].payload.completed, 2)
      assert.strictEqual(processedEvents[1].payload.remaining, 0)
      assert.notStrictEqual(processedEvents[1].payload.trackId, undefined)

      const tracks = await record.tracks.list({ addresses: [record.address] })

      assert.strictEqual(tracks.length, 2)
      assert.strictEqual(processedEvents[1].payload.trackId, tracks[0].id)
    })
  })
})
