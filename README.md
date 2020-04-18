# Record Node

[![MIT License](http://img.shields.io/badge/license-MIT-blue.svg?style=flat)](LICENSE) [![JavaScript Style Guide](https://img.shields.io/badge/code_style-standard-brightgreen.svg)](https://standardjs.com) [![standard-readme compliant](https://img.shields.io/badge/readme%20style-standard-brightgreen.svg?style=flat)](https://github.com/RichardLitt/standard-readme)
[![CircleCI Status](https://circleci.com/gh/mistakia/record-node.svg?style=shield)](https://circleci.com/gh/mistakia/record-node)
[![FOSSA Status](https://app.fossa.io/api/projects/git%2Bgithub.com%2Fmistakia%2Frecord-node.svg?type=shield)](https://app.fossa.io/projects/git%2Bgithub.com%2Fmistakia%2Frecord-node?ref=badge_shield)

> Library, CLI and REST API for Record.

A proof of concept distributed music application (library management, sharing, discovery & curation) built entirely on [IPFS](https://github.com/ipfs/js-ipfs). User data is stored on IPFS via a [scuttlebot](http://scuttlebot.io/)-esque immutable log via [IPFS-Log](https://github.com/orbitdb/ipfs-log) & [OrbitDB](https://github.com/orbitdb/orbit-db). Bootstraping/peer discovery is done via [bitboot](https://github.com/tintfoundation/bitboot).

*Note: View the [UI/UX repo](https://github.com/mistakia/record-app) for more information.*

## Install Dependencies
```
yarn install
```

### Install Chromaprint & FFmpeg

Note: fpcalc ([chromaprint](https://github.com/acoustid/chromaprint)) must be installed to be able to import audio files.
##### OSX using Homebrew
```
brew install chromaprint ffmpeg
```

##### Ubuntu
```
sudo apt-get install libchromaprint-tools
```

## Usage

### Running
```
yarn start
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
const RecordNode = require('record-node')

const node = new RecordNode()
node.on('ready', async () => {
    const log = await node.log.get() // or node.log.get(record.address)
})
await node.init()
```

## API
### RecordNode Constructor
```js
const record = new RecordNode(options)
```
View default options at [`config.js`](https://github.com/mistakia/record-node/blob/master/config.js). Use the `options` argument to specify configuration. It is an object with any of these properties:

##### `options.ipfs`

| Type | Default |
|------|---------|
| object | [`config.js`](https://github.com/mistakia/record-node/blob/master/config.js) |

options passed to [IPFS constructor](https://github.com/ipfs/js-ipfs#ipfs-constructor).

##### `options.api`

| Type | Default |
|------|---------|
| boolean | `false` |
| object | `{ port: 3000 }` |

Enable http api (Default: `undefined`)

##### `options.bitboot`

| Type | Default |
|------|---------|
| object | `{ enabled: true }` |

Enable finding peers via [bitboot](https://github.com/tintfoundation/bitboot)

## License
MIT


[![FOSSA Status](https://app.fossa.io/api/projects/git%2Bgithub.com%2Fmistakia%2Frecord-node.svg?type=large)](https://app.fossa.io/projects/git%2Bgithub.com%2Fmistakia%2Frecord-node?ref=badge_large)
