/* global describe it before after */

const assert = require('assert')
const {
  config,
  startRecord,
  createTrack
} = require('./utils')

describe('record.components.track.list', function () {
  this.timeout(config.timeout)
  let record
  const count = 20
  const artists = [
    'Clouds',
    'Fake Blood',
    'Boys Noize',
    'The Chemical Brothers',
    'Kris Menace',
    'Amtrac',
    'Todd Terje',
    'Siriusmo',
    'Monarchy',
    'SebastiAn',
    'Tensnake',
    'Azari & III',
    'Jimmy Edgar',
    'Aeroplane',
    'Yelle',
    'Danger',
    'Nero',
    'Nadastrom',
    'Robyn',
    'U-Tern'
  ]

  before(async () => {
    // eslint-disable-next-line
    ({ record } = await startRecord('0'));

    for (let i = 0; i < count; i++) {
      process.stdout.write(`\rPreparing - Writing: ${i}/${count}`)
      const options = {
        title: `${artists[i]}`, // TODO (low) use title fixtures
        artist: `${artists[i]}`,
        album: `${artists[i]}`, // TODO (low) use album fixtures
        bpm: i,
        duration: i,
        bitrate: i
      }
      await record.tracks.add(createTrack(`Hello${i}`, options))
    }
  })
  after(async () => record && record.stop())

  describe('order', function () {
    it('list', async () => {
      const tracks = await record.tracks.list({ addresses: [record.address] })
      assert.strictEqual(tracks.length, count)
      assert.strictEqual(tracks[3].content.tags.title, artists[count - 4])
      assert.strictEqual(tracks[0].content.tags.title, artists[count - 1])
    })
  })

  describe('sort', function () {
    // TODO (high) add asc

    it('artist', async () => {
      const tracks = await record.tracks.list({ addresses: [record.address], sort: 'artist', order: 'desc' })
      assert.strictEqual(tracks.length, count)
      assert.strictEqual(tracks[3].content.tags.artist, 'The Chemical Brothers')
      assert.strictEqual(tracks[0].content.tags.artist, 'Yelle')
    })

    it('title', async () => {
      const tracks = await record.tracks.list({ addresses: [record.address], sort: 'title', order: 'desc' })
      assert.strictEqual(tracks.length, count)
      assert.strictEqual(tracks[3].content.tags.title, 'The Chemical Brothers')
      assert.strictEqual(tracks[0].content.tags.title, 'Yelle')
    })

    it('album', async () => {
      const tracks = await record.tracks.list({ addresses: [record.address], sort: 'album', order: 'desc' })
      assert.strictEqual(tracks.length, count)
      assert.strictEqual(tracks[3].content.tags.album, 'The Chemical Brothers')
      assert.strictEqual(tracks[0].content.tags.album, 'Yelle')
    })

    it('bpm', async () => {
      const tracks = await record.tracks.list({ addresses: [record.address], sort: 'bpm', order: 'desc' })
      assert.strictEqual(tracks.length, count)
      assert.strictEqual(tracks[3].content.tags.bpm, count - 4)
      assert.strictEqual(tracks[0].content.tags.bpm, count - 1)
    })

    it('duration', async () => {
      const tracks = await record.tracks.list({ addresses: [record.address], sort: 'duration', order: 'desc' })
      assert.strictEqual(tracks.length, count)
      assert.strictEqual(tracks[3].content.audio.duration, count - 4)
      assert.strictEqual(tracks[0].content.audio.duration, count - 1)
    })

    it('bitrate', async () => {
      const tracks = await record.tracks.list({ addresses: [record.address], sort: 'bitrate', order: 'desc' })
      assert.strictEqual(tracks.length, count)
      assert.strictEqual(tracks[3].content.audio.bitrate, count - 4)
      assert.strictEqual(tracks[0].content.audio.bitrate, count - 1)
    })

    it('errors', async () => {
      // TODO (high) use invalid sort param
      // TODO (high) use invalid order param
    })
  })

  describe('filter', function () {
    /* it('artist', function () {

     * })
     */

    it('bpm', function () {

    })

    it('duration', function () {

    })

    it('bitrate', function () {

    })

    /* it('remixer', function () {

     * })
     */

    it('tags', async () => {
      // TODO (high) add tags fixture data for testing
      const tracks = await record.tracks.list({ addresses: [record.address], tags: ['Nero'] })
      assert.strictEqual(tracks.length, 0)
      // assert.strictEqual(tracks[0].content.tags.artist, 'Nero')
    })
  })

  describe('search', function () {
    it('query', async () => {
      const tracks = await record.tracks.list({ addresses: [record.address], query: 'Nero' })
      assert.strictEqual(tracks.length, 1)
      assert.strictEqual(tracks[0].content.tags.artist, 'Nero')
    })

    it('artist', async () => {

    })

    it('title', async () => {

    })

    it('album', async () => {

    })

    it('remixer', async () => {

    })

    it('resolvers', async () => {

    })
  })
})
