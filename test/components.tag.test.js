/* global describe it before after */

const assert = require('assert')
const path = require('path')
const {
  config,
  startRecord
} = require('./utils')

describe('record.track', function () {
  this.timeout(config.timeout)
  let record1, record2

  before(async () => {
    record2 = await startRecord(config.node2)
    record1 = await startRecord(config.node1, record2)
  })

  after(async () => {
    record1 && record1.stop()
    record2 && record2.stop()
  })

  describe('record.tag', function () {
    let track1
    const tagName1 = 'hello world'
    const tagName2 = 'hello dance'
    const tagName3 = 'hello disco'
    const tagName4 = 'hello dark'
    const filepath1 = path.join(__dirname, 'fixtures/Dj Falcon And Thomas Bangalter - So Much Love To Give(Original Mix).mp3')

    it('add + list', async function () {
      track1 = await record1.tracks.addTrackFromFile(filepath1)
      const tag = await record2.tags.add(track1.payload.value.contentCID, tagName1)
      const tracks = await record2.tracks.list()
      const tags = await record2.tags.list(record2.address)
      assert.strictEqual(tag.payload.value.tags.length, 1)
      assert.strictEqual(tag.payload.value.tags[0], tagName1)
      assert.strictEqual(tags.length, 1)
      assert.strictEqual(tracks.length, 1)
      assert.strictEqual(tracks[0].tags.length, 1)
      assert.strictEqual(tracks[0].tags[0], tagName1)
      // TODO: assert.strictEqual(log._oplog.length, 1)
    })

    it('delete', async function () {
      const tag = await record2.tags.remove(track1.payload.value.id, tagName1)
      const tracks = await record2.tracks.list()
      const tags = await record2.tags.list(record2.address)
      assert.strictEqual(tag.payload.value.tags.length, 0)
      assert.strictEqual(tags.length, 0)
      assert.strictEqual(tracks.length, 1)
      assert.strictEqual(tracks[0].tags.length, 0)
      assert.strictEqual(tracks[0].tags.includes(tagName1), false)
    })

    it('re-add', async function () {
      const tag = await record2.tags.add(track1.payload.value.contentCID, tagName1)
      const tracks = await record2.tracks.list()
      const tags = await record2.tags.list(record2.address)
      assert.strictEqual(tag.payload.value.tags.length, 1)
      assert.strictEqual(tag.payload.value.tags[0], tagName1)
      assert.strictEqual(tags.length, 1)
      assert.strictEqual(tracks.length, 1)
      assert.strictEqual(tracks[0].tags.length, 1)
      assert.strictEqual(tracks[0].tags[0], tagName1)
    })

    it('multiple', async function () {
      await record2.tags.add(track1.payload.value.contentCID, tagName2)
      await record2.tags.add(track1.payload.value.contentCID, tagName3)
      const tag4 = await record2.tags.add(track1.payload.value.contentCID, tagName4)
      const tracks = await record2.tracks.list()
      const tags = await record2.tags.list(record2.address)
      assert.strictEqual(tag4.payload.value.tags.length, 4)
      assert.strictEqual(tracks[0].tags.includes(tagName2), true)
      assert.strictEqual(tracks[0].tags.includes(tagName3), true)
      assert.strictEqual(tracks[0].tags.includes(tagName4), true)
      assert.strictEqual(tags.length, 4)
      assert.strictEqual(tracks.length, 1)
    })

    it('remove one', async function () {
      const tag = await record2.tags.remove(track1.payload.value.id, tagName2)
      const tracks = await record2.tracks.list()
      const tags = await record2.tags.list(record2.address)
      assert.strictEqual(tag.payload.value.tags.length, 3)
      assert.strictEqual(tags.length, 3)
      assert.strictEqual(tracks.length, 1)
      assert.strictEqual(tracks[0].tags.length, 3)
      assert.strictEqual(tracks[0].tags.includes(tagName1), true)
      assert.strictEqual(tracks[0].tags.includes(tagName2), false)
      assert.strictEqual(tracks[0].tags.includes(tagName3), true)
      assert.strictEqual(tracks[0].tags.includes(tagName4), true)
    })
  })
})
