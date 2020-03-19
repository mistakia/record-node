/* global describe it before after */

const path = require('path')
const assert = require('assert')
const {
  config,
  startRecord
} = require('./utils')

describe('record.track', function () {
  this.timeout(config.timeout)
  let record

  before(async () => { record = await startRecord(config.node1) })
  after(async () => record && record.stop())

  describe('record.track.addTrackFromFile', function () {
    let track1
    const filepath1 = path.join(__dirname, 'fixtures/Dj Falcon And Thomas Bangalter - So Much Love To Give(Original Mix).mp3')
    const filepath2 = path.join(__dirname, 'fixtures/8000 (Clouds Remix).mp3')

    describe('add', async function () {
      it('added with log length of 1', async function () {
        track1 = await record.tracks.addTrackFromFile(filepath1)
        assert.notStrictEqual(track1, undefined)
        assert.strictEqual(track1.payload.value.type, 'track')
        assert.strictEqual(track1.clock.time, 1)
        assert.strictEqual(track1.payload.value.content.audio.duration, 644.7804081632653)
      })

      it('contentCID', function () {
        assert.strictEqual(track1.payload.value.contentCID, 'zBwWX87m7x1bKBypHsTsG9tKcMsVFpAJH7WdmjJsPnCtMsn33KnqQsoicYG8VktQ4GDm8AcTJJHL8SXbGfP5E6JsB236S')
      })

      it('audio file hash', function () {
        assert.strictEqual(track1.payload.value.content.hash, 'QmQNBMWZexMA2EEhsc7BMoqnjWRqf5irXk6osNnh7oqNjS')
      })
    })

    describe('get', async function () {
      let track
      before(async () => { track = await record.tracks.get(record.address, track1.payload.value.id) })

      it('contentCID', function () {
        assert.strictEqual(track.contentCID, track1.payload.value.contentCID)
      })

      it('audio file hash', function () {
        assert.strictEqual(track.content.hash, track1.payload.value.content.hash)
      })
    })

    describe('list', async function () {
      let tracks
      before(async () => { tracks = await record.tracks.list(record.address) })

      it('has one track', function () {
        assert.strictEqual(tracks.length, 1)
      })

      it('contentCID', function () {
        assert.strictEqual(tracks[0].contentCID, track1.payload.value.contentCID)
      })

      it('audio file hash', function () {
        assert.strictEqual(tracks[0].content.hash, track1.payload.value.content.hash)
      })
    })

    describe('add duplicate', async function () {
      let track
      before(async () => { track = await record.tracks.addTrackFromFile(filepath1) })

      it('duplicate detected', async function () {
        assert.notStrictEqual(track1, undefined)
        assert.strictEqual(track1.payload.value.type, 'track')
        assert.strictEqual(track1.clock.time, 1)
      })

      it('list includes one track', async function () {
        const tracks = await record.tracks.list(record.address)
        assert.strictEqual(tracks.length, 1)
      })

      it('contentCID', function () {
        assert.strictEqual(track.payload.value.contentCID, track1.payload.value.contentCID)
      })

      it('audio file hash', function () {
        assert.strictEqual(track.payload.value.content.hash, track1.payload.value.content.hash)
      })
    })

    describe('remove track', async function () {
      before(async () => { await record.tracks.remove(track1.payload.value.id) })

      it('list doesnt include track', async function () {
        const tracks = await record.tracks.list(record.address)
        assert.strictEqual(tracks.length, 0)
      })
    })

    describe('re-add track', async function () {
      let track
      before(async () => { track = await record.tracks.addTrackFromFile(filepath1) })

      it('track added', async function () {
        assert.notStrictEqual(track, undefined)
        assert.strictEqual(track.payload.value.type, 'track')
        assert.strictEqual(track.clock.time, 3)
        assert.strictEqual(track.payload.value.content.audio.duration, 644.7804081632653)
      })
      it('contentCID', function () {
        assert.strictEqual(track.payload.value.contentCID, 'zBwWX87m7x1bKBypHsTsG9tKcMsVFpAJH7WdmjJsPnCtMsn33KnqQsoicYG8VktQ4GDm8AcTJJHL8SXbGfP5E6JsB236S')
      })

      it('audio file hash', function () {
        assert.strictEqual(track.payload.value.content.hash, 'QmQNBMWZexMA2EEhsc7BMoqnjWRqf5irXk6osNnh7oqNjS')
      })
    })

    describe('add new track', async function () {
      let track
      before(async () => { track = await record.tracks.addTrackFromFile(filepath2) })

      it('track added', async function () {
        assert.notStrictEqual(track, undefined)
        assert.strictEqual(track.payload.value.type, 'track')
        assert.strictEqual(track.clock.time, 4)
        assert.strictEqual(track.payload.value.content.audio.duration, 361.97877551020406)
      })
      it('contentCID', function () {
        assert.strictEqual(track.payload.value.contentCID, 'zBwWX6kZsDZvLw5aJaNbcSsjmQHrwQqTFXRqvBmuqRiUYj161PVZfQ225Fih4FmLRvuT5mKqJ1svRJK3ySwwDkgt33fWq')
      })

      it('audio file hash', function () {
        assert.strictEqual(track.payload.value.content.hash, 'QmUBX28q1teBSUMmvnbCDfXtYgM7kLqkjrWRrzeQx2qPoB')
      })
    })
  })
})
