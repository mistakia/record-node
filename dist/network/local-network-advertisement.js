// Advertises the node's client API on the local network as _record-api._tcp,
// so a client on the same LAN lists it without typing an address. The TXT
// record carries node_url (the URL to call, which for canonical is the
// reverse proxy's IP literal its certificate names) and peer_id (which the
// client matches against GET /settings). Discovery is unauthenticated: a
// client never sends a token to a discovered URL.
//
// A small responder on multicast-dns rather than a full Bonjour stack: the
// instance name includes the host name, so it needs no conflict probing.
import { hostname, networkInterfaces } from 'node:os';
import make_mdns from 'multicast-dns';
export const SERVICE_TYPE = '_record-api._tcp.local';
const SERVICE_ENUMERATION = '_services._dns-sd._udp.local';
const TTL_SECONDS = 120;
const ANNOUNCE_INTERVAL_MS = 1000;
const short_host_name = () => hostname().split('.')[0] || 'record-node';
const records_of = ({ node_url, peer_id, host_name }) => {
    const url = new URL(node_url);
    const instance = `${host_name}.${SERVICE_TYPE}`;
    const target = `record-node-${host_name}.local`;
    return [
        { name: SERVICE_ENUMERATION, type: 'PTR', ttl: TTL_SECONDS, data: SERVICE_TYPE },
        { name: SERVICE_TYPE, type: 'PTR', ttl: TTL_SECONDS, data: instance },
        { name: instance, type: 'SRV', ttl: TTL_SECONDS, flush: true, data: { port: Number(url.port), target, priority: 0, weight: 0 } },
        { name: instance, type: 'TXT', ttl: TTL_SECONDS, flush: true, data: [`node_url=${url.origin}`, `peer_id=${peer_id}`] },
        { name: target, type: 'A', ttl: TTL_SECONDS, flush: true, data: url.hostname }
    ];
};
// Starts answering for node_url's IPv4 host on the interface that holds it,
// announces twice, and resolves to a stop function that sends a TTL-zero
// goodbye. `port` is the mDNS port, 5353 except under test.
export const start_local_network_advertisement = async ({ node_url, peer_id, host_name = short_host_name(), port = 5353 }) => {
    const address = new URL(node_url).hostname;
    // multicast-dns swallows a failed group join, so an address this host does
    // not hold would otherwise advertise into nothing without a word.
    const held = Object.values(networkInterfaces()).flat().some((entry) => entry?.family === 'IPv4' && entry.address === address);
    if (!held)
        throw new Error(`no interface on this host has the address ${address}`);
    const records = records_of({ node_url, peer_id, host_name });
    // Bound to the wildcard so multicast queries arrive; the interface option
    // joins the group and sends only on node_url's interface.
    const mdns = make_mdns({ interface: address, bind: '0.0.0.0', port });
    await new Promise((resolve, reject) => {
        mdns.once('ready', resolve);
        mdns.once('error', reject);
    });
    mdns.on('error', (error) => { console.warn(`local network advertisement on ${address}: ${error.message}`); });
    mdns.on('warning', (error) => { console.warn(`local network advertisement on ${address}: ${error.message}`); });
    mdns.on('query', (query) => {
        // dns-packet decodes a type-255 question as 'ANY', which its types omit.
        const answers = records.filter((record) => (query.questions ?? []).some(({ name, type }) => name.toLowerCase() === record.name.toLowerCase() && (type === record.type || type === 'ANY')));
        if (answers.length === 0)
            return;
        const additionals = records.filter((record) => !answers.includes(record) && record.name !== SERVICE_ENUMERATION);
        mdns.respond({ answers, additionals });
    });
    const announce = (ttl) => { mdns.respond({ answers: records.map((record) => ({ ...record, ttl })) }); };
    announce(TTL_SECONDS);
    const second_announcement = setTimeout(() => { announce(TTL_SECONDS); }, ANNOUNCE_INTERVAL_MS);
    return async () => {
        clearTimeout(second_announcement);
        await new Promise((resolve) => {
            mdns.respond({ answers: records.map((record) => ({ ...record, ttl: 0 })) }, () => {
                mdns.destroy(() => { resolve(); });
            });
        });
    };
};
