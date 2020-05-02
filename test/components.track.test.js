/* global describe it before after */

const path = require('path')
const assert = require('assert')
const {
  config,
  startRecord
} = require('./utils')

describe('record.components.track', function () {
  this.timeout(config.timeout)
  let record

  before(async () => ({ record } = await startRecord('0')))
  after(async () => record && record.stop())

  describe('record.components.track.addTrackFromFile', function () {
    let track1
    const filepath1 = path.join(__dirname, 'fixtures/tracks/Dj Falcon And Thomas Bangalter - So Much Love To Give(Original Mix).mp3')
    const filepath2 = path.join(__dirname, 'fixtures/tracks/8000 (Clouds Remix).mp3')

    describe('add', async function () {
      it('added with log length of 1', async function () {
        track1 = await record.tracks.addTrackFromFile(filepath1)
        const entry = await record._log.tracks.getFromId(track1.id)
        assert.notStrictEqual(track1, undefined)
        assert.strictEqual(track1.type, 'track')
        assert.strictEqual(entry.clock.time, 1)
        assert.strictEqual(track1.content.audio.duration, 644.7804081632653)
      })

      it('contentCID', function () {
        assert.strictEqual(track1.contentCID, 'zBwWX7a3zJnTHiSM5SrTRS2XnavGF42zHq5Fom3hxmxs7zAgfRcsiNeuUJtAqmkGTsFzXLVNvFxc1dABnRUqVjGSxfa3d')
      })

      it('audio file hash', function () {
        assert.strictEqual(track1.content.hash, 'QmQNBMWZexMA2EEhsc7BMoqnjWRqf5irXk6osNnh7oqNjS')
      })
    })

    describe('get', async function () {
      let track
      before(async () => { track = await record.tracks.get({ logAddress: record.address, trackId: track1.id }) })

      it('contentCID', function () {
        assert.strictEqual(track.contentCID, track1.contentCID)
      })

      it('audio file hash', function () {
        assert.strictEqual(track.content.hash, track1.content.hash)
      })
    })

    describe('list', async function () {
      let tracks
      before(async () => { tracks = await record.tracks.list(record.address) })

      it('has one track', function () {
        assert.strictEqual(tracks.length, 1)
      })

      it('contentCID', function () {
        assert.strictEqual(tracks[0].contentCID, track1.contentCID)
      })

      it('audio file hash', function () {
        assert.strictEqual(tracks[0].content.hash, track1.content.hash)
      })
    })

    describe('add duplicate', async function () {
      let track
      before(async () => { track = await record.tracks.addTrackFromFile(filepath1) })

      it('duplicate detected', async function () {
        const entry = await record._log.tracks.getFromId(track1.id)
        assert.notStrictEqual(track1, undefined)
        assert.strictEqual(track1.type, 'track')
        assert.strictEqual(entry.clock.time, 1)
      })

      it('list includes one track', async function () {
        const tracks = await record.tracks.list(record.address)
        assert.strictEqual(tracks.length, 1)
      })

      it('contentCID', function () {
        assert.strictEqual(track.contentCID, track1.contentCID)
      })

      it('audio file hash', function () {
        assert.strictEqual(track.content.hash, track1.content.hash)
      })
    })

    describe('remove track', async function () {
      before(async () => { await record.tracks.remove(track1.id) })

      it('list doesnt include track', async function () {
        const tracks = await record.tracks.list(record.address)
        assert.strictEqual(tracks.length, 0)
      })
    })

    describe('re-add track', async function () {
      let track
      before(async () => { track = await record.tracks.addTrackFromFile(filepath1) })

      it('track added', async function () {
        const entry = await record._log.tracks.getFromId(track.id)
        assert.notStrictEqual(track, undefined)
        assert.strictEqual(track.type, 'track')
        assert.strictEqual(entry.clock.time, 3)
        assert.strictEqual(track.content.audio.duration, 644.7804081632653)
      })
      it('contentCID', function () {
        assert.strictEqual(track.contentCID, 'zBwWX7a3zJnTHiSM5SrTRS2XnavGF42zHq5Fom3hxmxs7zAgfRcsiNeuUJtAqmkGTsFzXLVNvFxc1dABnRUqVjGSxfa3d')
      })

      it('audio file hash', function () {
        assert.strictEqual(track.content.hash, 'QmQNBMWZexMA2EEhsc7BMoqnjWRqf5irXk6osNnh7oqNjS')
      })
    })

    describe('add new track', async function () {
      let track
      before(async () => { track = await record.tracks.addTrackFromFile(filepath2) })

      it('track added', async function () {
        const entry = await record._log.tracks.getFromId(track.id)
        assert.notStrictEqual(track, undefined)
        assert.strictEqual(track.type, 'track')
        assert.strictEqual(entry.clock.time, 4)
        assert.strictEqual(track.content.audio.duration, 361.97877551020406)
      })
      it('contentCID', function () {
        assert.strictEqual(track.contentCID, 'zBwWX7RGxWSQV43w8JB7abwsV1j5HqGZL8BYbTqRTh8CZBe9D68foYWk4xjXr9ChF9zNgXWejTk89c5Sa3ho2iYdb45WN')
      })

      it('audio file hash', function () {
        assert.strictEqual(track.content.hash, 'QmUBX28q1teBSUMmvnbCDfXtYgM7kLqkjrWRrzeQx2qPoB')
      })
    })
  })
})
