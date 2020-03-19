/* global describe it before after */

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

  describe('record.track.addTrackFromUrl', function () {
    let track1
    const urlpath1 = 'https://soundcloud.com/asa-moto101/kifesh?in=deewee-2/sets/asa-moto-playtime-deewee030'
    const urlpath2 = 'https://www.youtube.com/watch?v=a7jdHdR-oF8'

    describe('add', function () {
      it('added with log length of 1', async function () {
        track1 = await record.tracks.addTrackFromUrl(urlpath1)
        assert.notStrictEqual(track1, undefined)
        assert.strictEqual(track1.payload.value.type, 'track')
        assert.strictEqual(track1.clock.time, 1)
        assert.strictEqual(track1.payload.value.content.audio.duration, 276.34938775510204)
      })

      it('contentCID', function () {
        assert.strictEqual(track1.payload.value.contentCID, 'zBwWX6VWEjV4wYejntB6ejM5rxCsNFLmN6p6ta7YbLKX4zbK981h7fQZ3W4EGinWZqwK1haBNdQak8TczoAS9cNbTvvTv')
      })

      it('audio file hash', function () {
        assert.strictEqual(track1.payload.value.content.hash, 'QmSn3parzLeoSEThmfJNbRPtfMt91QQWCPjWdrP9x3WxS3')
      })
    })

    describe('get', function () {
      let track
      before(async () => { track = await record.tracks.get(record.address, track1.payload.value.id) })

      it('contentCID', function () {
        assert.strictEqual(track.contentCID, track1.payload.value.contentCID)
      })

      it('audio file hash', function () {
        assert.strictEqual(track.content.hash, track1.payload.value.content.hash)
      })
    })

    describe('list', function () {
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

    describe('add duplicate', function () {
      let track
      before(async () => { track = await record.tracks.addTrackFromUrl(urlpath1) })

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

    describe('remove track', function () {
      before(async () => { await record.tracks.remove(track1.payload.value.id) })

      it('list doesnt include track', async function () {
        const tracks = await record.tracks.list(record.address)
        assert.strictEqual(tracks.length, 0)
      })
    })

    describe('re-add track', function () {
      let track
      before(async () => { track = await record.tracks.addTrackFromUrl(urlpath1) })

      it('track added', function () {
        assert.notStrictEqual(track, undefined)
        assert.strictEqual(track.payload.value.type, 'track')
        assert.strictEqual(track.clock.time, 3)
        assert.strictEqual(track.payload.value.content.audio.duration, 276.34938775510204)
      })

      it('contentCID', function () {
        assert.strictEqual(track.payload.value.contentCID, 'zBwWX6VWEjV4wYejntB6ejM5rxCsNFLmN6p6ta7YbLKX4zbK981h7fQZ3W4EGinWZqwK1haBNdQak8TczoAS9cNbTvvTv')
      })

      it('audio file hash', function () {
        assert.strictEqual(track.payload.value.content.hash, 'QmSn3parzLeoSEThmfJNbRPtfMt91QQWCPjWdrP9x3WxS3')
      })
    })

    describe('add new track', function () {
      let track
      before(async () => { track = await record.tracks.addTrackFromUrl(urlpath2) })

      it('track added', function () {
        assert.notStrictEqual(track, undefined)
        assert.strictEqual(track.payload.value.type, 'track')
        assert.strictEqual(track.clock.time, 4)
        assert.strictEqual(track.payload.value.content.audio.duration, 560.9186167800453)
      })

      it('contentCID', function () {
        assert.strictEqual(track.payload.value.contentCID, 'zBwWX8Wk5q1kPRZyqGMQ1UQs2U7qEXoHmLWLZmzyruFryaqJS9KRG9N2dRbpZQMK3evzmuGNxTUf8K8wAXBE6K4pNg1kp')
      })

      it('audio file hash', function () {
        assert.strictEqual(track.payload.value.content.hash, 'QmYzoASpXMiUVs7nAq7vdga31N5ZmsSMEFzwvrPyioT7yC')
      })
    })
  })
})
