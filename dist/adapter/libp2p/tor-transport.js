// The §5.6.2 masked transport: TCP whose every socket is opened by a Tor
// SOCKS5 proxy. It reuses @libp2p/tcp for everything after the socket is
// open (connection wrapping, the pre-shared key, the upgrade) and replaces
// only its connect step. Outbound only: listening as an onion service is not
// defined. A hostname goes to the proxy unresolved, so Tor resolves it and
// the local resolver never sees it.
import { tcp } from '@libp2p/tcp';
import { SocksClient } from 'socks';
import { parse_host_port } from "./config.js";
// The dial target of a direct TCP multiaddr: /ip4, /ip6, /dns, /dns4 or
// /dns6, then /tcp, then at most a /p2p peer id.
export const socks_destination = (ma) => {
    const components = ma.getComponents();
    const [host, port, peer, ...rest] = components;
    if (host === undefined || port === undefined || port.name !== 'tcp' || rest.length > 0)
        return undefined;
    if (peer !== undefined && peer.name !== 'p2p')
        return undefined;
    if (!['ip4', 'ip6', 'dns', 'dns4', 'dns6'].includes(host.name) || host.value === undefined)
        return undefined;
    return { host: host.value, port: Number(port.value) };
};
const SOCKS_TIMEOUT_MS = 60_000;
const socks_connect = async ({ proxy, destination, signal }) => {
    signal.throwIfAborted();
    const { socket } = await SocksClient.createConnection({
        proxy: { host: proxy.host, port: proxy.port, type: 5 },
        command: 'connect',
        destination,
        timeout: SOCKS_TIMEOUT_MS,
        set_tcp_nodelay: true
    });
    if (signal.aborted) {
        socket.destroy();
        signal.throwIfAborted();
    }
    socket.setKeepAlive(true);
    return socket;
};
export const tor_transport = ({ socks_address }) => (components) => {
    const proxy = parse_host_port(socks_address);
    if (proxy === undefined)
        throw new TypeError(`socks_address must be host:port, not ${socks_address}`);
    const transport = tcp()(components);
    // @libp2p/tcp is pinned; a version that renames its connect step must fail
    // here, never fall back to a direct dial.
    if (typeof transport._connect !== 'function')
        throw new Error('@libp2p/tcp no longer has _connect; the Tor transport needs updating');
    transport._connect = async (ma, { signal }) => {
        const destination = socks_destination(ma);
        if (destination === undefined)
            throw new Error(`the Tor transport cannot dial ${ma.toString()}`);
        return await socks_connect({ proxy, destination, signal });
    };
    return Object.assign(transport, {
        [Symbol.toStringTag]: '@record/tor',
        createListener: () => { throw new Error('the Tor transport does not listen'); },
        listenFilter: () => [],
        dialFilter: (multiaddrs) => multiaddrs.filter((ma) => socks_destination(ma) !== undefined)
    });
};
