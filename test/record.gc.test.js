/* global describe it beforeEach afterEach */

const path = require('path')
const assert = require('assert')
const {
  config,
  startRecord,
  connectNode
} = require('./utils')

describe('record.gc', function () {
  this.timeout(config.timeout)
  let record, ipfsd
  let record2, ipfsd2

  beforeEach(async () => {
    try {
      // do not remove semicolons
      // eslint-disable-next-line
      ({ record, ipfsd } = await startRecord('0', { restartable: true }));
      // eslint-disable-next-line
      ({ record: record2, ipfsd: ipfsd2 } = await startRecord('1'));
      await connectNode(record, record2)
    } catch (err) {
      console.log(err)
    }
  })

  afterEach(async () => {
    record && await record.stop()
    ipfsd && await ipfsd.stop()
    record2 && await record2.stop()
    ipfsd2 && await ipfsd2.stop()
  })

  const runGC = async () => {
    // eslint-disable-next-line
    for await (const res of record._ipfs.repo.gc()) {
      // TODO (low) collect garbage collected pins for test assertions
    }
  }

  describe('gc', function () {
    const about = {
      name: 'Test Node',
      bio: 'a test node',
      location: 'test world'
    }

    it('manifest & access controller', async function () {
      const { address } = record2
      await record.logs.connect(address)
      await record2.stop()
      await ipfsd2.stop()
      await runGC()

      const log = await record.log.get(address)
      assert.strictEqual(log.id, address)
      // TODO (medium) check manifest address is in pinset
      // TODO (medium) check ac & ipfs ac address are in pinset
    })

    it('about', async function () {
      const aboutEntry = await record.about.set(about)
      assert.ok(aboutEntry.contentCID)
      const content = await record._ipfs.dag.get(aboutEntry.cid)

      await runGC()

      const entry = await record.about.get(record.address)
      assert.deepStrictEqual(aboutEntry, entry)
      const afterContent = await record._ipfs.dag.get(aboutEntry.cid)
      assert.deepStrictEqual(content, afterContent)

      // TODO (medium) check log entry hash is in pinset
      // TODO (medium) check log entry content cid is in pinset
    })

    it('track', async function () {
      const filepath = path.join(__dirname, 'fixtures/tracks/Dj Falcon And Thomas Bangalter - So Much Love To Give(Original Mix).mp3')
      const track = await record.tracks.addTrackFromFile(filepath)
      const entry = await record.log.getLogEntryFromId(record.address, track.id)

      const dagEntry = await record._ipfs.dag.get(entry.hash)
      const dagContent = await record._ipfs.dag.get(entry.payload.value.contentCID)
      const dagAudio = await record._ipfs.dag.get(entry.payload.value.content.hash)

      await runGC()

      const afterEntry = await record.log.getLogEntryFromId(record.address, track.id)
      const afterDagEntry = await record._ipfs.dag.get(entry.hash)
      const afterDagContent = await record._ipfs.dag.get(entry.payload.value.contentCID)
      const afterDagAudio = await record._ipfs.dag.get(entry.payload.value.content.hash)

      assert.deepStrictEqual(afterEntry, entry)
      assert.deepStrictEqual(afterDagEntry, dagEntry)
      assert.deepStrictEqual(afterDagContent, dagContent)
      assert.deepStrictEqual(afterDagAudio, dagAudio)

      // TODO (high) check log entry content cid is in pinset
      // TODO (high) check audio hash is in pinset
      // TODO (high) check artwork hash is in pinset

      const statsBefore = await record._ipfs.repo.stat()

      await record.tracks.remove(track.id)

      await runGC()

      const statsAfter = await record._ipfs.repo.stat()

      const removedEntry = await record.log.getLogEntryFromId(record.address, track.id)
      const removedDagEntry = await record._ipfs.dag.get(entry.hash)
      const removedDagContent = await record._ipfs.dag.get(entry.payload.value.contentCID)
      let removedDagAudio
      try {
        removedDagAudio = await record._ipfs.dag.get(entry.payload.value.content.hash, { timeout: 2000 })
      } catch (e) {

      }

      // TODO (high) check log entry hash is in pinset
      // TODO (high) check log entry content cid is not in pinset
      // TODO (high) check audio hash is not in pinset
      // TODO (high) check artwork hash is not in pinset

      assert.ok(!removedEntry)
      assert.ok(removedDagEntry)
      assert.ok(removedDagContent)
      assert.ok(!removedDagAudio)
      assert.strictEqual(statsAfter.repoSize.toNumber() < statsBefore.repoSize.toNumber(), true)
    })

    it('track in linked log', async function () {
      // add track in log 2
      const filepath = path.join(__dirname, 'fixtures/tracks/Dj Falcon And Thomas Bangalter - So Much Love To Give(Original Mix).mp3')
      const track = await record2.tracks.addTrackFromFile(filepath)
      const entry = await record2.log.getLogEntryFromId(record2.address, track.id)

      // add link to log 2
      await record.logs.link({
        alias: 'record2',
        linkAddress: record2.address
      })
      await record.logs.connect(record2.address)

      const dagEntry = await record._ipfs.dag.get(entry.hash)
      const dagContent = await record._ipfs.dag.get(entry.payload.value.contentCID)
      const dagAudio = await record._ipfs.dag.get(entry.payload.value.content.hash)

      // pin track in log 2
      await record._ipfs.pin.add(track.content.hash)

      await record2.stop()
      await ipfsd2.stop()
      await runGC()

      const afterLinkEntry = await record.log.getLogEntryFromId(record2.address, track.id)
      const afterLinkDagEntry = await record._ipfs.dag.get(entry.hash)
      const afterLinkDagContent = await record._ipfs.dag.get(entry.payload.value.contentCID)
      const afterLinkDagAudio = await record._ipfs.dag.get(entry.payload.value.content.hash)
      assert.deepStrictEqual(afterLinkEntry, entry)
      assert.deepStrictEqual(afterLinkDagEntry, dagEntry)
      assert.deepStrictEqual(afterLinkDagContent, dagContent)
      assert.deepStrictEqual(afterLinkDagAudio, dagAudio)

      await record.logs.unlink(record2.address)
      await runGC()

      const afterUnlinkEntry = await record.log.getLogEntryFromId(record2.address, track.id)

      let afterUnlinkDagEntry
      try {
        afterUnlinkDagEntry = await record._ipfs.dag.get(entry.hash, { timeout: 2000 })
      } catch (e) {

      }

      let afterUnlinkDagContent
      try {
        afterUnlinkDagContent = await record._ipfs.dag.get(entry.payload.value.contentCID, { timeout: 2000 })
      } catch (e) {

      }

      let afterUnlinkDagAudio
      try {
        afterUnlinkDagAudio = await record._ipfs.dag.get(entry.payload.value.content.hash, { timeout: 2000 })
      } catch (e) {

      }

      assert.deepStrictEqual(afterUnlinkEntry, undefined)
      assert.deepStrictEqual(afterUnlinkDagEntry, undefined)
      assert.deepStrictEqual(afterUnlinkDagContent, undefined)
      assert.deepStrictEqual(afterUnlinkDagAudio, undefined)
    })

    // TODO (high) add test for checking pins for log links
  })
})
