<a href="https://bafybeidk4zev2jlw2jijtdyufo3itspx45k4ynq634x4rjm6ycjfdvxfrq.ipfs.infura-ipfs.io/" title="Record">
  <img src="https://github.com/mistakia/record-app/raw/master/resources/icon.png" alt="Record Logo" width="150" />
</a>

# Record Node

[![MIT License](http://img.shields.io/badge/license-MIT-blue.svg?style=flat)](LICENSE) [![JavaScript Style Guide](https://img.shields.io/badge/code_style-standard-brightgreen.svg)](https://standardjs.com) [![standard-readme compliant](https://img.shields.io/badge/readme%20style-standard-brightgreen.svg?style=flat)](https://github.com/RichardLitt/standard-readme)
[![CircleCI Status](https://circleci.com/gh/mistakia/record-node.svg?style=shield)](https://circleci.com/gh/mistakia/record-node)
[![FOSSA Status](https://app.fossa.io/api/projects/git%2Bgithub.com%2Fmistakia%2Frecord-node.svg?type=shield)](https://app.fossa.io/projects/git%2Bgithub.com%2Fmistakia%2Frecord-node?ref=badge_shield)

> Library, CLI and REST API for Record.

Record is a proof of concept immutable distributed system for audio files. Built entirely on [IPFS](https://github.com/ipfs/js-ipfs), user data is stored in a [scuttlebot](http://scuttlebot.io/)-esque immutable log via [IPFS-Log](https://github.com/orbitdb/ipfs-log) & [OrbitDB](https://github.com/orbitdb/orbit-db). Bootstraping/peer discovery is done via [bitboot](https://github.com/tintfoundation/bitboot).

At it's core, the application intends to be a media library management & playback system akin to [beets](https://github.com/beetbox/beets) with the ability to join various sources of music like [tomahawk player](https://github.com/tomahawk-player/tomahawk). By building everything on top of IPFS, it can become a connected network of libraries, opening the door to many other possibilities (i.e. soundcloud & musicbrainz), while still being entirely distributed and thus being able to function permanently.

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
const createIPFSDaemon = require('record-ipfsd')

const ipfsd = await createIPFSDaemon({
    repo: repoPath,
    ipfsBin: ipfsBinPath
})

const node = new RecordNode()
node.on('ready', async () => {
    const log = await node.log.get() // or node.log.get(record.address)
})
await node.init(ipfsd)
```

## API
### RecordNode Constructor
```js
const record = new RecordNode(options)
```
View default options at [`config.js`](https://github.com/mistakia/record-node/blob/master/config.js). Use the `options` argument to specify configuration. It is an object with any of these properties:

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
