# Record Node

[![MIT License](http://img.shields.io/badge/license-MIT-blue.svg?style=flat)](LICENSE) [![JavaScript Style Guide](https://img.shields.io/badge/code_style-standard-brightgreen.svg)](https://standardjs.com) [![standard-readme compliant](https://img.shields.io/badge/readme%20style-standard-brightgreen.svg?style=flat)](https://github.com/RichardLitt/standard-readme)
[![FOSSA Status](https://app.fossa.io/api/projects/git%2Bgithub.com%2Fmistakia%2Frecord-node.svg?type=shield)](https://app.fossa.io/projects/git%2Bgithub.com%2Fmistakia%2Frecord-node?ref=badge_shield)

> Library, CLI and REST API for Record.

A proof of concept distributed social & music application (library, sharing, discovery & curation) network built entirely on [IPFS](https://github.com/ipfs/js-ipfs). User data is stored via a [scuttlebot](http://scuttlebot.io/)-like immutable log via [IPFS-Log](https://github.com/orbitdb/ipfs-log) & [OrbitDB](https://github.com/orbitdb/orbit-db).

## Install
```
npm install
```

## Usage

### Running
```
npm run start
```

### CLI
```
wip
```

### Daemon
```
wip
```

### Module
```js
const IPFS = require('ipfs')
const RecordNode = require('record-node')
const OrbitDB = require('orbit-db')

const ipfs = new IPFS()
ipfs.on('ready', async () => {
    const record = new RecordNode(ipfs, OrbitDB)
    await record.init()
    const log = await record.log.get() // or record.log.get(record.address)
})
```

## API
### RecordNode Constructor
```js
const record = new RecordNode(ipfs, OrbitDB, options)
```
Use the `options` argument to specify configuration. It is an object with any of these properties:
- `orbitPath` (string): The file path passed to OrbitDB. (Default: `undefined`)
- `api` (boolean or object): Initialize the api when creating Record Node instance (Default: `undefined`)

#### record.init([address])
Returns a `Promise`
- `address` (string): name or valid OrbitDB database address. (Default: `record`)

## License
MIT


[![FOSSA Status](https://app.fossa.io/api/projects/git%2Bgithub.com%2Fmistakia%2Frecord-node.svg?type=large)](https://app.fossa.io/projects/git%2Bgithub.com%2Fmistakia%2Frecord-node?ref=badge_large)
