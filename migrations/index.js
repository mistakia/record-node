const migrations = {
  0: require('./0')
}

class MigrationSource {
  getMigrations () {
    return Promise.resolve(Object.keys(migrations))
  }

  getMigrationName (migration) {
    return migration
  }

  getMigration (migration) {
    return migrations[migration]
  }
}

module.exports = MigrationSource
