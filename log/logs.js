const LogEntry = require('./LogEntry')

module.exports = function logs(self) {

  function filterEntries(mapper) {
    return (doc) => {
      if (doc.type !== 'log')
	return false

      return mapper ? mapper(doc) : true
    }
  }  

  return {
    all: (mapper) => {
      const all = self._log.query(filterEntries(mapper))
      return all
    },
    
    add: async (data) => {
      const entry = new LogEntry().create(data)
      const hash = await self._log.put(entry)
      return hash
    },

    get: (key) => {
      const data = self._log.get(key)
      return data
    },

    del: async (key) => {
      const hash = await self._log.del(key)
      return hash
    }
  }
}
