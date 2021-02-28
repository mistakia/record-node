/* global describe it before after */

const assert = require('assert')
const path = require('path')
const {
  config,
  startRecord,
  connectNode
} = require('./utils')

describe('record.components', function () {
  this.timeout(config.timeout)
  let record1, record2

  before(async () => {
    // eslint-disable-next-line
    ({ record: record1 } = await startRecord('0'));
    // eslint-disable-next-line
    ({ record: record2 } = await startRecord('1'));
    await connectNode(record1, record2)
  })

  after(async () => {
    record1 && await record1.stop()
    record2 && await record2.stop()
  })

  describe('record.components.tags', function () {
    let track1
    const tagName1 = 'hello world'
    const tagName2 = 'hello dance'
    const tagName3 = 'hello disco'
    const tagName4 = 'hello dark'
    const filepath1 = path.join(__dirname, 'fixtures/tracks/Dj Falcon And Thomas Bangalter - So Much Love To Give(Original Mix).mp3')

    describe('add', async function () {
      it('list', async () => {
        track1 = await record1.tracks.addTrackFromFile(filepath1)
        const track = await record2.tags.add(track1.contentCID, tagName1)
        const tracks = await record2.tracks.list({ addresses: [record2.address] })
        const tags = await record2.tags.list(record2.address)
        assert.strictEqual(track.tags.length, 1)
        assert.strictEqual(track.tags[0].tag, tagName1)
        assert.strictEqual(tags.length, 1)
        assert.strictEqual(tracks.length, 1)
        assert.strictEqual(tracks[0].tags.length, 1)
        assert.strictEqual(tracks[0].tags[0].tag, tagName1)
        assert.strictEqual(record2._log._oplog.length, 1)
      })

      it('index', async () => {
        const tags = await record2._db('tags')
        assert.strictEqual(tags.length, 1)
        const tag = tags[0]
        assert.strictEqual(tag.address, record2.address)
        assert.strictEqual(tag.trackid, track1.id)
        assert.strictEqual(tag.tag, tagName1)
      })
    })

    describe('delete', async function () {
      it('list', async () => {
        const track = await record2.tags.remove(track1.id, tagName1)
        const tracks = await record2.tracks.list({ addresses: [record2.address] })
        const tags = await record2.tags.list(record2.address)
        assert.strictEqual(track.tags.length, 0)
        assert.strictEqual(tags.length, 0)
        assert.strictEqual(tracks.length, 1)
        assert.strictEqual(tracks[0].tags.length, 0)
        assert.strictEqual(tracks[0].tags.find(t => t.tag === tagName1), undefined)
      })

      it('index', async () => {
        const tags = await record2._db('tags')
        assert.strictEqual(tags.length, 0)
      })
    })

    describe('re-add', async function () {
      it('list', async () => {
        const track = await record2.tags.add(track1.contentCID, tagName1)
        const tracks = await record2.tracks.list({ addresses: [record2.address] })
        const tags = await record2.tags.list(record2.address)
        assert.strictEqual(track.tags.length, 1)
        assert.strictEqual(track.tags[0].tag, tagName1)
        assert.strictEqual(tags.length, 1)
        assert.strictEqual(tracks.length, 1)
        assert.strictEqual(tracks[0].tags.length, 1)
        assert.strictEqual(tracks[0].tags[0].tag, tagName1)
      })

      it('index', async () => {
        const tags = await record2._db('tags')
        assert.strictEqual(tags.length, 1)
        const tag = tags[0]
        assert.strictEqual(tag.address, record2.address)
        assert.strictEqual(tag.trackid, track1.id)
        assert.strictEqual(tag.tag, tagName1)
      })
    })

    describe('multiple', async function () {
      it('list', async () => {
        await record2.tags.add(track1.contentCID, tagName2)
        await record2.tags.add(track1.contentCID, tagName3)
        const tag4 = await record2.tags.add(track1.contentCID, tagName4)
        const tracks = await record2.tracks.list({ addresses: [record2.address] })
        const tags = await record2.tags.list(record2.address)
        assert.strictEqual(tag4.tags.length, 4)
        assert.strictEqual(tracks[0].tags.some(t => t.tag === tagName2), true)
        assert.strictEqual(tracks[0].tags.some(t => t.tag === tagName3), true)
        assert.strictEqual(tracks[0].tags.some(t => t.tag === tagName4), true)
        assert.strictEqual(tags.length, 4)
        assert.strictEqual(tracks.length, 1)
      })

      it('index', async () => {
        const tags = await record2._db('tags')
        assert.strictEqual(tags.length, 4)
        const tag = tags[3]
        assert.strictEqual(tag.address, record2.address)
        assert.strictEqual(tag.trackid, track1.id)
        assert.strictEqual(tag.tag, tagName4)
      })
    })

    describe('remove one', async function () {
      it('list', async () => {
        const track = await record2.tags.remove(track1.id, tagName2)
        const tracks = await record2.tracks.list({ addresses: [record2.address] })
        const tags = await record2.tags.list(record2.address)
        assert.strictEqual(track.tags.length, 3)
        assert.strictEqual(tags.length, 3)
        assert.strictEqual(tracks.length, 1)
        assert.strictEqual(tracks[0].tags.length, 3)
        assert.strictEqual(tracks[0].tags.some(t => t.tag === tagName1), true)
        assert.strictEqual(tracks[0].tags.some(t => t.tag === tagName2), false)
        assert.strictEqual(tracks[0].tags.some(t => t.tag === tagName3), true)
        assert.strictEqual(tracks[0].tags.some(t => t.tag === tagName4), true)
      })

      it('index', async () => {
        const tags = await record2._db('tags')
        assert.strictEqual(tags.length, 3)
        const tagNames = tags.map(t => t.tag)
        assert.strictEqual(tagNames.includes(tagName2), false)
      })
    })

    it('duplicate', async function () {
      // TODO (high) add test to detect duplicate tags
      // TODO (high) assert oplog length
    })

    it('reordered duplicate', async function () {
      // TODO (high) add test to detect duplicate tags in shifted order
      // TODO (high) assert oplog length
    })
  })
})
