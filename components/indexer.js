const path = require('path')

const Errors = require('../errors')
const knex = require('knex')
const { CID } = require('ipfs-http-client')
const { default: PQueue } = require('p-queue')

const { loadEntryContent } = require('../utils')
const MigrationSource = require('../migrations')

const indexManager = new PQueue({ concurrency: 100, timeout: 30000 })
module.exports = function indexer (self) {
  return {
    _loading: {},
    _processing: {},
    _init: async () => {
      self.logger.info('[node] initializing index')
      const config = {
        client: 'sqlite3',
        connection: {
          filename: path.resolve(self._options.directory, './index'),
          multipleStatements: true
        },
        useNullAsDefault: true,
        pool: {
          min: 2,
          max: 10
        },
        migrations: {
          tableName: 'migrations'
        }
      }

      self._db = knex(config)
      await self._db.migrate.latest({
        migrationSource: new MigrationSource()
      })
    },

    trackCount: async (address) => {
      const rows = await self._db('tracks')
        .where({ address })
        .count({ tracks: 'address' })

      return rows[0].tracks
    },

    logCount: async (address) => {
      const rows = await self._db('links')
        .where({ address })
        .count({ logs: 'address' })

      return rows[0].logs
    },

    indexQueueSize: (address) => {
      return Object.keys(self.indexer._processing[address] || {}).length
    },

    isLoading: (address) => {
      return !!self.indexer._loading[address]
    },

    isProcessing: (address) => {
      return !!self.indexer.indexQueueSize(address)
    },

    load: async (log) => {
      self.indexer._loading[log.id] = true
      const queueHashes = Object.keys(self.indexer._processing[log.id] || {})
      const entryHashes = Array.from(log._oplog._hashIndex.keys())
      const hashes = entryHashes.filter(h => !queueHashes.includes(h))

      // TODO (medium) refactor (see below)
      // sort hashes, pull out top 50 shared prefixes, query index (select distinct)

      for (const entryHash of hashes) {
        const rows = await self._db('entries').where({ hash: entryHash }).limit(1)
        if (rows.length) continue

        const entry = await log._oplog.get(entryHash)
        // Check to see if entry contents are local, add to indexManager if not
        if (CID.isCID(entry.payload.value.content)) {
          const haveLocally = await self._ipfs.repo.has(entry.payload.value.content)
          if (!haveLocally) {
            self.indexer._process(entry)
            continue
          }
        }

        const loadedEntry = await loadEntryContent(self._ipfs, entry)
        await self.indexer.add(loadedEntry)
      }
    },

    _add: async (entry, type) => {
      switch (type) {
        case 'about':
          return self.indexer._addAbout(entry)

        case 'track':
          return self.indexer._addTrack(entry)

        case 'log':
          return self.indexer._addLog(entry)

        default:
          throw Errors.InvalidEntryTypeError()
      }
    },

    _addAbout: async (entry) => {
      const { name, location, bio, avatar } = entry.payload.value.content
      const address = entry.payload.value.content.address || entry.id
      const id = entry.payload.key
      return self._db('logs')
        .insert({ name, location, bio, avatar, address, id })
        .onConflict('id')
        .merge()
    },

    _addToTracks: async (entry) => {
      const address = entry.id
      const id = entry.payload.value.id
      const {
        title, artist, artists, albumartist, album, remixer, bpm
      } = entry.payload.value.content.tags
      const { duration, bitrate } = entry.payload.value.content.audio
      const data = {
        title, artist, artists, albumartist, album, remixer, bpm, duration, bitrate
      }

      return self._db('tracks')
        .insert({ ...data, id, address })
        .onConflict(['address', 'id'])
        .merge()
    },

    _addToTags: async (entry) => {
      const address = entry.id
      const trackid = entry.payload.key
      const { tags } = entry.payload.value

      const rows = await self._db('tags').where({ address, trackid })
      const current = rows.map(r => r.tag)
      const dels = current.filter(t => !tags.includes(t))
      const adds = tags.filter(t => !current.includes(t))

      if (dels.length) {
        // TODO (low) bulk delete
        for (const del of dels) {
          await self._db('tags').where({ tag: del, address, trackid }).del()
        }
      }

      if (adds.length) {
        const inserts = adds.map(t => ({ tag: t, address, trackid }))
        await self._db('tags').insert(inserts)
      }
    },

    _addToResolvers: async (entry) => {
      const trackid = entry.payload.key
      const { resolver } = entry.payload.value.content

      for (const item of resolver) {
        const { extractor, id, fulltitle } = item
        try {
          await self._db('resolvers').insert({ trackid, extractor, id, fulltitle })
        } catch (err) {
          const msg = err.toString()
          if (!msg.includes('SQLITE_CONSTRAINT: UNIQUE')) {
            self.logger.error(err)
          }
        }
      }
    },

    _addTrack: async (entry) => {
      await self.indexer._addToTracks(entry)
      await self.indexer._addToTags(entry)
      await self.indexer._addToResolvers(entry)
    },

    _addLog: async (entry) => {
      const address = entry.id
      const id = entry.payload.key
      const { alias, address: link } = entry.payload.value.content
      await self._db('links').insert({ address, alias, link, id }).onConflict(['address', 'link', 'id']).merge()
    },

    _addListen: async (entry) => {
      const { trackId: trackid, timestamp } = entry.payload
      await self._db('listens').insert({ trackid, timestamp })
    },

    _remove: async (entry, type) => {
      switch (type) {
        case 'track':
          return self.indexer._removeTrack(entry)

        case 'log':
          return self.indexer._removeLog(entry)

        default:
          throw Errors.InvalidEntryTypeError()
      }
    },

    _removeLog: async (entry) => {
      const address = entry.id
      const id = entry.payload.key

      const links = await self._db('links').where({ address, id })
      const linkAddress = links[0].link

      // check if linked in other libraries
      const rows = await self._db('links')
        .where({ link: linkAddress })
        .whereNot({ address: self.address })
      if (rows.length) return self._db('links').where({ address, id }).del()

      const linkedEntries = await self._db('entries').where({ address: linkAddress })
      const linkedEntryKeys = linkedEntries.map(e => e.key)
      const nonUniqueEntries = await self._db('entries')
        .whereNot({ address: linkAddress })
        .whereIn('key', linkedEntryKeys)
        .groupBy('key')
      const nonUniqueKeys = nonUniqueEntries.map(e => e.key)
      const uniqueEntries = linkedEntries.filter(e => !nonUniqueKeys.includes(e.key))

      const log = await self.log.get(linkAddress)
      for (const hash of log._oplog._hashIndex.keys()) {
        // remove entry pins
        await self._ipfs.pin.rm(hash, { recursive: false })

        // remove entry index
        await self._db('entries').where({ hash }).del()

        const uniqueEntry = uniqueEntries.find(e => e.hash === hash)
        if (uniqueEntry) {
          if (uniqueEntry.type === 'track') {
            await self._db('tracks').where({ id: uniqueEntry.key }).del()
            await self._db('resolvers').where({ trackid: uniqueEntry.key }).del()
          }

          const dagNode = await self._ipfs.dag.get(uniqueEntry.cid, { timeout: 3000 })
          if (!dagNode) continue

          // remove content pin
          try {
            await self._ipfs.pin.rm(uniqueEntry.cid)
          } catch (e) {
            self.logger.error(e)
          }

          // remove audio pin
          try {
            await self._ipfs.pin.rm(dagNode.value.hash)
          } catch (e) {
            self.logger.error(e)
          }

          // remove artwork pins
          try {
            for (const cid of dagNode.value.artwork) {
              await self._ipfs.pin.rm(cid)
            }
          } catch (e) {
            self.logger.error(e)
          }
        }
      }

      await self._db('logs').where({ address: linkAddress }).del()
      await self._db('tags').where({ address: linkAddress }).del()

      return self._db('links').where({ address, id }).del()
    },

    _deleteTrackAudioAndArtwork: async (id) => {
      const rows = await self._db('entries')
        .where({ key: id })
        .orderBy('clock', 'desc')
        .orderBy('timestamp', 'desc')

      for (const row of rows) {
        const { cid } = row

        const dagNode = await self._ipfs.dag.get(cid, { timeout: 3000 })
        if (!dagNode.value) {
          continue
        }
        const { hash, artwork } = dagNode.value

        try {
          await self._ipfs.pin.rm(hash) // remove audio
        } catch (err) {
          self.logger.error(err)
        }

        for (const cid of artwork) {
          try {
            await self._ipfs.pin.rm(cid) // remove artwork
          } catch (err) {
            self.logger.error(err)
          }
        }
      }
    },

    _removeTrack: async (entry) => {
      const address = entry.id
      const id = entry.payload.key
      await self._db('tracks').where({ address, id }).del()
      await self._db('tags').where({ address, trackid: id }).del()

      const results = await self._db('tracks').where({ id }).whereNot({ address })
      // ignore if track is in other linked logs or in own log
      if (results.length) {
        return
      }

      const entries = await self._db('entries').where({ key: id })
      for (const entry of entries) {
        const dagNode = await self._ipfs.dag.get(entry.cid, { timeout: 3000 })
        try {
          await self._ipfs.pin.rm(entry.cid)
        } catch (error) {
          self.logger.error(error)
        }

        try {
          await self._ipfs.pin.rm(dagNode.value.hash)
        } catch (error) {
          self.logger.error(error)
        }

        try {
          for (const cid of dagNode.value.artwork) {
            await self._ipfs.pin.rm(cid)
          }
        } catch (error) {
          self.logger.error(error)
        }
      }

      await self._db('resolvers').where({ trackid: id }).del()
      await self.indexer._deleteTrackAudioAndArtwork(id)
    },

    _process: async (entry) => {
      if (!self.indexer._processing[entry.id]) {
        self.indexer._processing[entry.id] = {}
      }

      self.indexer._processing[entry.id][entry.hash] = true

      await indexManager.add(async () => {
        try {
          const log = await self.log.get(entry.id)
          log.events.emit('processing', self.indexer.indexQueueSize(entry.id))

          const loadedEntry = await loadEntryContent(self._ipfs, entry)
          await self.indexer.add(loadedEntry)
        } catch (error) {
          self.logger.error(error)
        }
      })

      delete self.indexer._processing[entry.id][entry.hash]

      if (!self.indexer.isProcessing(entry.id)) {
        self.emit('redux', {
          type: 'LOG_INDEX_UPDATED',
          payload: { address: entry.id, isProcessingIndex: false }
        })
      }
    },

    add: async (entry) => {
      const address = entry.id
      const { key, op } = entry.payload
      const { type, timestamp } = entry.payload.value
      const clock = entry.clock.time

      const rows = await self._db('entries')
        .where({ key, address })
        .orderBy('clock', 'desc')
        .orderBy('timestamp', 'desc')

      // update index only if entry clock is larger
      if (!rows.length || (clock >= rows[0].clock && timestamp > rows[0].timestamp)) {
        if (op === 'PUT') {
          await self.indexer._add(entry, type)
        } else if (op === 'DEL') {
          await self.indexer._remove(entry, type)
        }
      }

      const { hash } = entry
      const cid = entry.payload.value.contentCID

      if (op !== 'DEL') {
        await self._db('entries').insert({
          address, hash, type, op, clock, key, cid, timestamp
        })
      } else {
        await self._db('entries').where({
          address, key, type
        }).del()
      }

      const log = await self.log.get(address)
      log.events.emit('indexUpdated', self.indexer.indexQueueSize(address), entry)
    },

    drop: async (address) => {
      // TODO (v0.0.2) iterate tracks and logs, send to remove
      // TODO (v0.0.2) drop from log table
    }
  }
}
