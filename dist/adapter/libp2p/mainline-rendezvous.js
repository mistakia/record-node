// The §5.2.1 shared bootstrap service as a libp2p service: bitboot on the
// mainline DHT. It looks the rendezvous up at start and every
// lookup_interval_ms and dials each address found. It announces only the
// port of a public TCP address libp2p holds as verified (AutoNAT-confirmed,
// UPnP-mapped, or configured as announce_addresses), re-checking whenever the
// node's addresses change, and otherwise never announces: a NATed node with
// no mapping would publish an address nobody can dial.
import { create_rendezvous } from 'bitboot';
import { isPrivate } from '@libp2p/utils';
import { multiaddr } from '@multiformats/multiaddr';
import { RENDEZVOUS_NAME } from "./config.js";
const DIAL_TIMEOUT_MS = 30_000;
// The first IPv4 TCP address that is verified and public. The mainline DHT
// stores IPv4 announcements, and a circuit address is not dialable directly.
export const confirmed_public_port = (addresses) => {
    for (const { multiaddr: address, verified } of addresses) {
        if (!verified || isPrivate(address))
            continue;
        const [ip, tcp, ...rest] = address.getComponents();
        if (ip?.name !== 'ip4' || tcp?.name !== 'tcp')
            continue;
        if (rest.some(({ name }) => name !== 'p2p'))
            continue;
        return Number(tcp.value);
    }
    return null;
};
const address_key = ({ host, port }) => `${host}:${port}`;
export const mainline_rendezvous = (config) => (components) => {
    const log = components.logger.forComponent('record:mainline-rendezvous');
    let rendezvous = null;
    let ready = Promise.resolve();
    let lookup_timer = null;
    let announced = null;
    let running = false;
    const own_addresses = () => {
        const own = new Set();
        for (const { multiaddr: address } of components.addressManager.getAddressesWithMetadata()) {
            const [ip, tcp] = address.getComponents();
            if (ip?.name === 'ip4' && tcp?.name === 'tcp')
                own.add(`${ip.value}:${tcp.value}`);
        }
        return own;
    };
    // Anyone can announce under the info hash, so an entry is a hint: a private
    // address would only make this node probe its own network.
    const dial = (peer) => {
        if (!running || own_addresses().has(address_key(peer)))
            return;
        const target = multiaddr(`/ip4/${peer.host}/tcp/${peer.port}`);
        if (!config.dial_private && isPrivate(target) !== false)
            return;
        const connected = components.connectionManager.getConnections().some(({ remoteAddr }) => {
            const [ip, tcp] = remoteAddr.getComponents();
            return ip?.value === peer.host && tcp?.name === 'tcp' && Number(tcp.value) === peer.port;
        });
        if (connected)
            return;
        components.connectionManager.openConnection(target, { signal: AbortSignal.timeout(DIAL_TIMEOUT_MS) })
            .catch((error) => { log('dial %s failed: %s', target.toString(), error.message); });
    };
    const update_announcement = () => {
        if (!running || rendezvous === null)
            return;
        const port = confirmed_public_port(components.addressManager.getAddressesWithMetadata());
        if (port === announced)
            return;
        announced = port;
        log('announcing %s', port ?? 'nothing');
        const current = rendezvous;
        ready.then(async () => {
            // A stop since then leaves nothing to announce on.
            if (rendezvous !== current || !running)
                return;
            await current.announce(port);
        })
            .catch((error) => { log.error('announce failed - %e', error); });
    };
    const lookup = async () => {
        const current = rendezvous;
        if (current === null)
            return null;
        await ready;
        return await current.lookup();
    };
    const on_addresses_changed = () => { update_announcement(); };
    return {
        [Symbol.toStringTag]: '@record/mainline-rendezvous',
        start: () => {
            running = true;
            const created = create_rendezvous({
                name: RENDEZVOUS_NAME,
                dht_port: config.port,
                ...(config.dht_bootstrap === undefined ? {} : { dht_bootstrap: config.dht_bootstrap })
            });
            rendezvous = created;
            created.on('peer', dial);
            created.on('warning', (error) => { log('dht warning: %s', error.message); });
            created.on('error', (error) => { log.error('dht error - %e', error); });
            // Joining the DHT takes seconds; libp2p's start does not wait on it.
            ready = created.start();
            ready.catch((error) => { log.error('dht start failed - %e', error); });
            const look = () => { lookup().catch((error) => { log('lookup failed: %s', error.message); }); };
            look();
            lookup_timer = setInterval(look, config.lookup_interval_ms);
            lookup_timer.unref();
            components.events.addEventListener('self:peer:update', on_addresses_changed);
            update_announcement();
        },
        stop: async () => {
            running = false;
            components.events.removeEventListener('self:peer:update', on_addresses_changed);
            if (lookup_timer !== null)
                clearInterval(lookup_timer);
            lookup_timer = null;
            announced = null;
            const current = rendezvous;
            rendezvous = null;
            await current?.stop();
        },
        announced_port: () => announced,
        count_addresses: async () => {
            const found = await lookup();
            return found === null ? null : found.length;
        }
    };
};
