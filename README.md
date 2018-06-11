# Record Node

[![MIT License](http://img.shields.io/badge/license-MIT-blue.svg?style=flat)](LICENSE) [![JavaScript Style Guide](https://img.shields.io/badge/code_style-standard-brightgreen.svg)](https://standardjs.com) [![standard-readme compliant](https://img.shields.io/badge/readme%20style-standard-brightgreen.svg?style=flat)](https://github.com/RichardLitt/standard-readme)

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
    const rn = new RecordNode(ipfs, OrbitDB)

    await rn.load()
    // ready
})
```

## API
### RecordNode Constructor
```js
const rn = new RecordNode(ipfs, OrbitDB, options)
```
Use the `options` argument to specify configuration. It is an object with any of these properties:
- `orbitPath` (string): The file path passed to OrbitDB. (Default: `undefined`)
- `orbitAddress` (string): Valid OrbitDB database address. (Default: `undefined`)
- `api` (boolean or object): Initialize the api when creating Record Node instance (Default: `undefined`)
- `logConfig` (object): Options passed to OrbitDB when creating log.
  - `replicate` (boolean): Subscribe to updates via IPFS pubsub (Default: `true`)
  - `replicationConcurrency` (integer): (Default: `128`)

## License
MIT
