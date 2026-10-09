// The subset of bittorrent-dht 11 the local test DHT uses; the package ships
// no types.
declare module 'bittorrent-dht' {
  import { EventEmitter } from 'node:events'

  export default class DHT extends EventEmitter {
    constructor (options?: { bootstrap?: string[] | false })
    listen (port: number, onlistening?: () => void): void
    address (): { address: string, family: string, port: number }
    destroy (callback?: () => void): void
  }
}
