exports.up = async function (knex) {
  await knex.schema.createTable('logs', (table) => {
    table.text('id').notNullable().unique()
    table.text('address').primary()
    table.text('name').nullable()
    table.text('location').nullable()
    table.text('bio').nullable()
    table.text('avatar').nullable()
  })

  await knex.schema.createTable('tracks', (table) => {
    table.text('address').notNullable()
    table.text('id').notNullable()
    table.text('title').nullable()
    table.text('artist').nullable()
    table.text('artists').nullable()
    table.text('albumartist').nullable()
    table.text('album').nullable()
    table.text('remixer').nullable()
    table.integer('bpm').nullable()
    table.integer('duration').notNullable()
    table.integer('bitrate').notNullable()
    table.unique(['address', 'id'])
  })

  await knex.schema.createTable('resolvers', (table) => {
    table.text('trackid').notNullable()
    table.text('extractor').notNullable()
    table.text('fulltitle').notNullable()
    table.text('id').notNullable()
    table.unique(['trackid', 'extractor', 'id'])
  })

  await knex.schema.createTable('entries', (table) => {
    table.text('address').notNullable().index()
    table.text('hash').notNullable().unique()
    table.text('type').notNullable()
    table.text('op').notNullable()
    table.integer('clock').notNullable()
    table.text('key').notNullable().index()
    table.text('cid').nullable().index()
    table.integer('timestamp').notNullable()
  })

  await knex.schema.createTable('tags', (table) => {
    table.text('address').notNullable()
    table.text('trackid').notNullable()
    table.text('tag').notNullable()
    table.unique(['address', 'trackid', 'tag'])
  })

  await knex.schema.createTable('links', (table) => {
    table.text('address').notNullable()
    table.text('link').notNullable()
    table.text('id').notNullable()
    table.text('alias').nullable()
    table.unique(['address', 'link', 'id'])
  })

  await knex.schema.createTable('listens', (table) => {
    table.text('trackid').index().notNullable()
    table.integer('timestamp').notNullable()
  })
}

exports.down = async function (knex) {
  await knex.schema.dropTable('links')
  await knex.schema.dropTable('tags')
  await knex.schema.dropTable('resolvers')
  await knex.schema.dropTable('tracks')
  await knex.schema.dropTable('entries')
  await knex.schema.dropTable('logs')
  await knex.schema.dropTable('listens')
}
