/* global describe it before after */

const path = require('path')
const assert = require('assert')
const {
  config,
  startRecord
} = require('./utils')

describe('record.gc', function () {
  this.timeout(config.timeout)
  let record, ipfsd

  before(async () => {
    ({ record, ipfsd } = await startRecord('0', { restartable: true }))
  })

  after(async () => {
    record && await record.stop()
    ipfsd && await ipfsd.stop()
  })

  const runGC = async () => {
    for await (const res of record._ipfs.repo.gc())

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

    // TODO manifest

    // TODO access controller

    it('about', async function () {
      const aboutEntry = await record.about.set(about)
      assert.ok(aboutEntry.contentCID)
      const content = await record._ipfs.dag.get(aboutEntry.cid)

      await runGC()

      const entry = await record.about.get(record.address)
      assert.deepStrictEqual(aboutEntry, entry)
      const afterContent = await record._ipfs.dag.get(aboutEntry.cid)
      assert.deepStrictEqual(content, afterContent)
    })

    it('track', async function () {
      const filepath = path.join(__dirname, 'fixtures/tracks/Dj Falcon And Thomas Bangalter - So Much Love To Give(Original Mix).mp3')
      const track = await record.tracks.addTrackFromFile(filepath)
      const entry = await record._log.tracks.getFromId(track.id)

      const dagEntry = await record._ipfs.dag.get(entry.hash)
      const dagContent = await record._ipfs.dag.get(entry.payload.value.contentCID)
      const dagAudio = await record._ipfs.dag.get(entry.payload.value.content.hash)

      await runGC()

      const afterEntry = await record._log.tracks.getFromId(track.id)
      const afterDagEntry = await record._ipfs.dag.get(entry.hash)
      const afterDagContent = await record._ipfs.dag.get(entry.payload.value.contentCID)
      const afterDagAudio = await record._ipfs.dag.get(entry.payload.value.content.hash)

      assert.deepStrictEqual(afterEntry, entry)
      assert.deepStrictEqual(afterDagEntry, dagEntry)
      assert.deepStrictEqual(afterDagContent, dagContent)
      assert.deepStrictEqual(afterDagAudio, dagAudio)

      const statsBefore = await record._ipfs.repo.stat()

      await record.tracks.remove(track.id)

      await runGC()

      const statsAfter = await record._ipfs.repo.stat()

      const removedEntry = await record._log.tracks.getFromId(track.id)
      const removedDagEntry = await record._ipfs.dag.get(entry.hash)
      const removedDagContent = await record._ipfs.dag.get(entry.payload.value.contentCID)
      let removedDagAudio
      try {
        removedDagAudio = await record._ipfs.dag.get(entry.payload.value.content.hash, undefined, { timeout: 2000 })
      } catch (e) {

      }

      assert.ok(!removedEntry)
      assert.ok(removedDagEntry)
      assert.ok(removedDagContent)
      assert.ok(!removedDagAudio)
      assert.strictEqual(statsAfter.repoSize.toNumber() < statsBefore.repoSize.toNumber(), true)
    })
  })
})
