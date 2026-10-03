// The §5.5.1 network's configuration, apart from the libp2p modules it
// configures, so loading a peer config never loads libp2p.
export const DEFAULT_NETWORK_CONFIG = Object.freeze({
    listen: Object.freeze(['/ip4/0.0.0.0/tcp/0']),
    bootstrap: Object.freeze([]),
    mdns: true,
    dht: true
});
