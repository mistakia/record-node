/* global describe it before after */

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

  describe('record.components.track.addTrackFromUrl', function () {
    let tracks
    const urlpath1 = 'https://soundcloud.com/asa-moto101/kifesh?in=deewee-2/sets/asa-moto-playtime-deewee030'
    const urlpath2 = 'https://www.youtube.com/watch?v=a7jdHdR-oF8'

    describe('add', function () {
      it('added with log length of 1', async function () {
        tracks = await record.tracks.addTrackFromUrl(urlpath1)
        assert.notStrictEqual(tracks[0], undefined)
        assert.strictEqual(tracks[0].type, 'track')
        assert.strictEqual(record._log._oplog.length, 1)
        assert.strictEqual(tracks[0].content.audio.duration, 276.34938775510204)
      })

      it('contentCID', function () {
        assert.strictEqual(tracks[0].contentCID, 'zBwWX9K3D55gieRxaF2iDSCSoKxLfuDjL7fGytKp9hFM6RumJbQrEkcoyjCaoVAzD9vkcH5uzEJLjX6ePd33ng7bfc6ij')
      })

      it('audio file hash', function () {
        assert.strictEqual(tracks[0].content.hash, 'QmSn3parzLeoSEThmfJNbRPtfMt91QQWCPjWdrP9x3WxS3')
      })
    })

    describe('get', function () {
      let track
      before(async () => { track = await record.tracks.get({ address: record.address, trackId: tracks[0].id }) })

      it('contentCID', function () {
        assert.strictEqual(track.contentCID, tracks[0].contentCID)
      })

      it('audio file hash', function () {
        assert.strictEqual(track.content.hash, tracks[0].content.hash)
      })
    })

    describe('list', function () {
      let tracks
      before(async () => { tracks = await record.tracks.list({ address: [record.address] }) })

      it('has one track', function () {
        assert.strictEqual(tracks.length, 1)
      })

      it('contentCID', function () {
        assert.strictEqual(tracks[0].contentCID, tracks[0].contentCID)
      })

      it('audio file hash', function () {
        assert.strictEqual(tracks[0].content.hash, tracks[0].content.hash)
      })
    })

    describe('add duplicate', function () {
      let track
      before(async () => { track = await record.tracks.addTrackFromUrl(urlpath1) })

      it('duplicate detected', async function () {
        assert.notStrictEqual(tracks[0], undefined)
        assert.strictEqual(tracks[0].type, 'track')
        assert.strictEqual(record._log._oplog.length, 1)
        // TODO (high) assert oplog length
      })

      it('list includes one track', async function () {
        const tracks = await record.tracks.list({ address: [record.address] })
        assert.strictEqual(tracks.length, 1)
      })

      it('contentCID', function () {
        assert.strictEqual(track[0].contentCID, tracks[0].contentCID)
      })

      it('audio file hash', function () {
        assert.strictEqual(track[0].content.hash, tracks[0].content.hash)
      })
    })

    describe('remove track', function () {
      before(async () => { await record.tracks.remove(tracks[0].id) })

      it('list doesnt include track', async function () {
        const tracks = await record.tracks.list({ address: [record.address] })
        assert.strictEqual(tracks.length, 0)
      })
    })

    describe('re-add track', function () {
      let track
      before(async () => { track = await record.tracks.addTrackFromUrl(urlpath1) })

      it('track added', async function () {
        assert.notStrictEqual(track[0], undefined)
        assert.strictEqual(track[0].type, 'track')
        assert.strictEqual(record._log._oplog.length, 3)
        assert.strictEqual(track[0].content.audio.duration, 276.34938775510204)
      })

      it('contentCID', function () {
        assert.strictEqual(track[0].contentCID, 'zBwWX9K3D55gieRxaF2iDSCSoKxLfuDjL7fGytKp9hFM6RumJbQrEkcoyjCaoVAzD9vkcH5uzEJLjX6ePd33ng7bfc6ij')
      })

      it('audio file hash', function () {
        assert.strictEqual(track[0].content.hash, 'QmSn3parzLeoSEThmfJNbRPtfMt91QQWCPjWdrP9x3WxS3')
      })
    })

    describe('add new track', function () {
      let track
      before(async () => { track = await record.tracks.addTrackFromUrl(urlpath2) })

      it('track added', async function () {
        assert.notStrictEqual(track[0], undefined)
        assert.strictEqual(track[0].type, 'track')
        assert.strictEqual(record._log._oplog.length, 4)
        assert.strictEqual(track[0].content.audio.duration, 560.9186167800453)
      })

      it('contentCID', function () {
        assert.strictEqual(track[0].contentCID, 'zBwWX5dPcTAKjurHvbUA62qEp2RG23WVzXFF1qpbH2RcYwWCEihAayJfnqqWcVSS4jJAJRJUXa3cL6iqEdfTG3bpwH7hk')
      })

      it('audio file hash', function () {
        assert.strictEqual(track[0].content.hash, 'QmYzoASpXMiUVs7nAq7vdga31N5ZmsSMEFzwvrPyioT7yC')
      })
    })
  })
})
