/* global describe it before after */

const path = require('path')
const assert = require('assert')
const {
  config,
  startRecord
} = require('./utils')

describe('record.components.track.add', function () {
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
        assert.notStrictEqual(track1, undefined)
        assert.strictEqual(track1.type, 'track')
        assert.strictEqual(record._log._oplog.length, 1)
        assert.strictEqual(track1.content.audio.duration, 644.7804081632653)
      })

      it('entries index', async () => {
        const entries = await record._db('entries')
        assert.strictEqual(entries.length, 1)
        const entry = entries[0]
        assert.strictEqual(entry.address, record.address)
        //assert.strictEqual(entry.hash, track1)
        assert.strictEqual(entry.type, 'track')
        assert.strictEqual(entry.op, 'PUT')
        assert.strictEqual(entry.clock, 1)
        assert.strictEqual(entry.key, '0db212b18c9093b6d77090e4764d3f2210c091fafda6d8f11e5d937575ffb2c0')
        assert.strictEqual(entry.cid, 'zBwWX7a3zJnTHiSM5SrTRS2XnavGF42zHq5Fom3hxmxs7zAgfRcsiNeuUJtAqmkGTsFzXLVNvFxc1dABnRUqVjGSxfa3d')
      })

      it('tracks index', async () => {
        const tracks = await record._db('tracks')
        assert.strictEqual(tracks.length, 1)
        const track = tracks[0]
        assert.strictEqual(track.address, record.address)
        assert.strictEqual(track.id, '0db212b18c9093b6d77090e4764d3f2210c091fafda6d8f11e5d937575ffb2c0')
        assert.strictEqual(track.title, 'So Much Love To Give(Original Mix)')
        assert.strictEqual(track.artist, 'Dj Falcon And Thomas Bangalter')
        assert.strictEqual(track.artists, 'Dj Falcon And Thomas Bangalter')
        assert.strictEqual(track.albumartist, null)
        assert.strictEqual(track.album, null)
        assert.strictEqual(track.remixer, null)
        assert.strictEqual(track.bpm, null)
        assert.strictEqual(track.duration, 644.7804081632653)
        assert.strictEqual(track.bitrate, 192000)
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
      before(async () => { track = await record.tracks.get({ address: record.address, trackId: track1.id }) })

      it('contentCID', function () {
        assert.strictEqual(track.contentCID, track1.contentCID)
      })

      it('audio file hash', function () {
        assert.strictEqual(track.content.hash, track1.content.hash)
      })
    })

    describe('list', async function () {
      let tracks
      before(async () => { tracks = await record.tracks.list({ addresses: [record.address] }) })

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
        assert.notStrictEqual(track1, undefined)
        assert.strictEqual(track1.type, 'track')
        assert.strictEqual(record._log._oplog.length, 1)
        // TODO (high) assert oplog length
      })

      it('entries index', async () => {
        const entries = await record._db('entries')
        assert.strictEqual(entries.length, 1)
        const entry = entries[0]
        assert.strictEqual(entry.address, record.address)
        //assert.strictEqual(entry.hash, track1)
        assert.strictEqual(entry.type, 'track')
        assert.strictEqual(entry.op, 'PUT')
        assert.strictEqual(entry.clock, 1)
        assert.strictEqual(entry.key, '0db212b18c9093b6d77090e4764d3f2210c091fafda6d8f11e5d937575ffb2c0')
        assert.strictEqual(entry.cid, 'zBwWX7a3zJnTHiSM5SrTRS2XnavGF42zHq5Fom3hxmxs7zAgfRcsiNeuUJtAqmkGTsFzXLVNvFxc1dABnRUqVjGSxfa3d')
      })

      it('tracks index', async () => {
        const tracks = await record._db('tracks')
        assert.strictEqual(tracks.length, 1)
        const track = tracks[0]
        assert.strictEqual(track.address, record.address)
        assert.strictEqual(track.id, '0db212b18c9093b6d77090e4764d3f2210c091fafda6d8f11e5d937575ffb2c0')
        assert.strictEqual(track.title, 'So Much Love To Give(Original Mix)')
        assert.strictEqual(track.artist, 'Dj Falcon And Thomas Bangalter')
        assert.strictEqual(track.artists, 'Dj Falcon And Thomas Bangalter')
        assert.strictEqual(track.albumartist, null)
        assert.strictEqual(track.album, null)
        assert.strictEqual(track.remixer, null)
        assert.strictEqual(track.bpm, null)
        assert.strictEqual(track.duration, 644.7804081632653)
        assert.strictEqual(track.bitrate, 192000)
      })

      it('list includes one track', async function () {
        const tracks = await record.tracks.list({ addresses: [record.address] })
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
        const tracks = await record.tracks.list({ addresses: [record.address] })
        assert.strictEqual(tracks.length, 0)
      })

      it('entries index', async () => {
        const entries = await record._db('entries')
        assert.strictEqual(entries.length, 0)
      })

      it('tracks index', async () => {
        const tracks = await record._db('tracks')
        assert.strictEqual(tracks.length, 0)
      })
    })

    describe('re-add track', async function () {
      let track
      before(async () => { track = await record.tracks.addTrackFromFile(filepath1) })

      it('track added', async function () {
        assert.notStrictEqual(track, undefined)
        assert.strictEqual(track.type, 'track')
        assert.strictEqual(record._log._oplog.length, 3)
        assert.strictEqual(track.content.audio.duration, 644.7804081632653)
      })

      it('entries index', async () => {
        const entries = await record._db('entries')
        assert.strictEqual(entries.length, 1)
        const entry = entries[0]
        assert.strictEqual(entry.address, record.address)
        //assert.strictEqual(entry.hash, track1)
        assert.strictEqual(entry.type, 'track')
        assert.strictEqual(entry.op, 'PUT')
        assert.strictEqual(entry.clock, 3)
        assert.strictEqual(entry.key, '0db212b18c9093b6d77090e4764d3f2210c091fafda6d8f11e5d937575ffb2c0')
        assert.strictEqual(entry.cid, 'zBwWX7a3zJnTHiSM5SrTRS2XnavGF42zHq5Fom3hxmxs7zAgfRcsiNeuUJtAqmkGTsFzXLVNvFxc1dABnRUqVjGSxfa3d')
      })

      it('tracks index', async () => {
        const tracks = await record._db('tracks')
        assert.strictEqual(tracks.length, 1)
        const track = tracks[0]
        assert.strictEqual(track.address, record.address)
        assert.strictEqual(track.id, '0db212b18c9093b6d77090e4764d3f2210c091fafda6d8f11e5d937575ffb2c0')
        assert.strictEqual(track.title, 'So Much Love To Give(Original Mix)')
        assert.strictEqual(track.artist, 'Dj Falcon And Thomas Bangalter')
        assert.strictEqual(track.artists, 'Dj Falcon And Thomas Bangalter')
        assert.strictEqual(track.albumartist, null)
        assert.strictEqual(track.album, null)
        assert.strictEqual(track.remixer, null)
        assert.strictEqual(track.bpm, null)
        assert.strictEqual(track.duration, 644.7804081632653)
        assert.strictEqual(track.bitrate, 192000)
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
        assert.notStrictEqual(track, undefined)
        assert.strictEqual(track.type, 'track')
        assert.strictEqual(record._log._oplog.length, 4)
        assert.strictEqual(track.content.audio.duration, 361.97877551020406)
      })

      it('entries index', async () => {
        const entries = await record._db('entries')
        assert.strictEqual(entries.length, 2)
        const entry = entries[1]
        assert.strictEqual(entry.address, record.address)
        //assert.strictEqual(entry.hash, track1)
        assert.strictEqual(entry.type, 'track')
        assert.strictEqual(entry.op, 'PUT')
        assert.strictEqual(entry.clock, 4)
        assert.strictEqual(entry.key, 'bc48ea541d77cf4957e4081d61a771f7f18fc72753cc5c55cae0c8ed76e7109b')
        assert.strictEqual(entry.cid, 'zBwWX7RGxWSQV43w8JB7abwsV1j5HqGZL8BYbTqRTh8CZBe9D68foYWk4xjXr9ChF9zNgXWejTk89c5Sa3ho2iYdb45WN')
      })

      it('tracks index', async () => {
        const tracks = await record._db('tracks')
        assert.strictEqual(tracks.length, 2)
        const track = tracks[1]
        assert.strictEqual(track.address, record.address)
        assert.strictEqual(track.id, 'bc48ea541d77cf4957e4081d61a771f7f18fc72753cc5c55cae0c8ed76e7109b')
        assert.strictEqual(track.title, '8000 (Clouds Remix)')
        assert.strictEqual(track.artist, 'Proxy')
        assert.strictEqual(track.artists, 'Proxy')
        assert.strictEqual(track.albumartist, null)
        assert.strictEqual(track.album, null)
        assert.strictEqual(track.remixer, null)
        assert.strictEqual(track.bpm, null)
        assert.strictEqual(track.duration, 361.97877551020406)
        assert.strictEqual(track.bitrate, 320000)
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
