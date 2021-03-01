/* global describe it before after */

const path = require('path')
const assert = require('assert')
const {
  config,
  startRecord
} = require('./utils')

describe('record.components.track.remove', function () {
  this.timeout(config.timeout)
  let record
  let track1
  const filepath1 = path.join(__dirname, 'fixtures/tracks/Dj Falcon And Thomas Bangalter - So Much Love To Give(Original Mix).mp3')

  before(async () => {
    ({ record } = await startRecord('0'))
    track1 = await record.tracks.addTrackFromFile(filepath1)
    await record.tracks.remove(track1.id)
  })
  after(async () => record && record.stop())

  describe('remove track', function () {
    it('list', async function () {
      const tracks = await record.tracks.list({ addresses: [record.address] })
      assert.strictEqual(tracks.length, 0)
    })

    it('entries index', async function () {
      const entries = await record._db('entries')
      assert.strictEqual(entries.length, 0)
    })

    it('tracks index', async function () {
      const tracks = await record._db('tracks')
      assert.strictEqual(tracks.length, 0)
    })

    it('pins', async function () {
      const pins = []
      for await (const { cid } of record._ipfs.pin.ls({ type: 'direct' })) {
        pins.push(cid.toBaseEncodedString('base58btc'))
      }
      // TODO (low) compare pins
      assert.strictEqual(pins.length, 2)
    })
  })

  describe('resolver', async () => {
    // TODO (medium) make sure resolver is removed
    // TODO (medium) make sure non-exclusive resolver is not removed
  })
})
