/* global describe it before after */

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

  before(async () => {
    // eslint-disable-next-line
    ({ record, ipfsd } = await startRecord('0', { restartable: true }));
    // eslint-disable-next-line
    ({ record: record2, ipfsd: ipfsd2 } = await startRecord('1'));
    await connectNode(record, record2)
  })

  after(async () => {
    record && await record.stop()
    ipfsd && await ipfsd.stop()
  })

  const runGC = async () => {
    // eslint-disable-next-line
    for await (const res of record._ipfs.repo.gc()) {
      // TODO (low) collect garbage collected pins for test assertions
    }

    await record.stop()
    await ipfsd.stop()

    await ipfsd.start()
    await record.start()
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

    // TODO (high) add test for checking pins for log links
  })
})
