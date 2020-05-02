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

    it('add + list', async function () {
      track1 = await record1.tracks.addTrackFromFile(filepath1)
      const track = await record2.tags.add(track1.contentCID, tagName1)
      const tracks = await record2.tracks.list()
      const tags = await record2.tags.list(record2.address)
      assert.strictEqual(track.tags.length, 1)
      assert.strictEqual(track.tags[0], tagName1)
      assert.strictEqual(tags.length, 1)
      assert.strictEqual(tracks.length, 1)
      assert.strictEqual(tracks[0].tags.length, 1)
      assert.strictEqual(tracks[0].tags[0], tagName1)
      // TODO: assert.strictEqual(log._oplog.length, 1)
    })

    it('delete', async function () {
      const track = await record2.tags.remove(track1.id, tagName1)
      const tracks = await record2.tracks.list()
      const tags = await record2.tags.list(record2.address)
      assert.strictEqual(track.tags.length, 0)
      assert.strictEqual(tags.length, 0)
      assert.strictEqual(tracks.length, 1)
      assert.strictEqual(tracks[0].tags.length, 0)
      assert.strictEqual(tracks[0].tags.includes(tagName1), false)
    })

    it('re-add', async function () {
      const track = await record2.tags.add(track1.contentCID, tagName1)
      const tracks = await record2.tracks.list()
      const tags = await record2.tags.list(record2.address)
      assert.strictEqual(track.tags.length, 1)
      assert.strictEqual(track.tags[0], tagName1)
      assert.strictEqual(tags.length, 1)
      assert.strictEqual(tracks.length, 1)
      assert.strictEqual(tracks[0].tags.length, 1)
      assert.strictEqual(tracks[0].tags[0], tagName1)
    })

    it('multiple', async function () {
      await record2.tags.add(track1.contentCID, tagName2)
      await record2.tags.add(track1.contentCID, tagName3)
      const tag4 = await record2.tags.add(track1.contentCID, tagName4)
      const tracks = await record2.tracks.list()
      const tags = await record2.tags.list(record2.address)
      assert.strictEqual(tag4.tags.length, 4)
      assert.strictEqual(tracks[0].tags.includes(tagName2), true)
      assert.strictEqual(tracks[0].tags.includes(tagName3), true)
      assert.strictEqual(tracks[0].tags.includes(tagName4), true)
      assert.strictEqual(tags.length, 4)
      assert.strictEqual(tracks.length, 1)
    })

    it('remove one', async function () {
      const track = await record2.tags.remove(track1.id, tagName2)
      const tracks = await record2.tracks.list()
      const tags = await record2.tags.list(record2.address)
      assert.strictEqual(track.tags.length, 3)
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
