// Node configuration for the process entry point: a JSON file named by
// --config or RECORD_CONFIG, under flag overrides, over the defaults.
import { readFile } from 'node:fs/promises';
import { isIPv4 } from 'node:net';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { parse_library_address } from '#encoding/library-address.ts';
import { DEFAULT_PEER_CONFIG, resolve_peer_config } from '#peer/config.ts';
export const DEFAULT_PORT = 3000;
export const DEFAULT_HOST = '127.0.0.1';
export const default_data_dir = () => join(homedir(), '.record');
const FILE_KEYS = new Set(['port', 'host', 'cors_origins', 'remote_listener', 'managed_label_libraries', 'node_url', 'local_network_advertisement', 'data_dir', 'index_dir', 'ytdlp_path', ...Object.keys(DEFAULT_PEER_CONFIG)]);
const read_config_file = async (path) => {
    const value = JSON.parse(await readFile(path, 'utf8'));
    if (value === null || typeof value !== 'object' || Array.isArray(value))
        throw new TypeError(`${path} must hold a JSON object`);
    const unknown = Object.keys(value).filter((key) => !FILE_KEYS.has(key));
    if (unknown.length > 0)
        throw new TypeError(`${path} has unknown keys: ${unknown.join(', ')}`);
    return value;
};
const port_of = (value) => {
    const port = typeof value === 'string' ? Number(value) : value;
    if (!Number.isSafeInteger(port) || port < 0 || port > 65535)
        throw new RangeError(`port must be 0-65535, not ${String(value)}`);
    return port;
};
const cors_origins_of = (value) => {
    if (value === undefined)
        return undefined;
    if (!Array.isArray(value) || !value.every((origin) => typeof origin === 'string'))
        throw new TypeError('cors_origins must be an array of origin strings');
    if (value.includes('null'))
        throw new TypeError('cors_origins may not allow the origin null');
    return Object.freeze([...value]);
};
const remote_listener_of = (value) => {
    if (value === undefined)
        return undefined;
    if (value === null || typeof value !== 'object' || Array.isArray(value))
        throw new TypeError('remote_listener must be an object of host and port');
    const { host, port, ...rest } = value;
    const unknown = Object.keys(rest);
    if (unknown.length > 0)
        throw new TypeError(`remote_listener has unknown keys: ${unknown.join(', ')}`);
    if (typeof host !== 'string' || host === '')
        throw new TypeError('remote_listener.host must be a host string');
    if (typeof port !== 'number')
        throw new TypeError('remote_listener.port must be a number');
    return Object.freeze({ host, port: port_of(port) });
};
// { "<library address>": "<access-token id>" }, as `record-node token list` shows ids.
const managed_label_libraries_of = (value) => {
    if (value === undefined)
        return new Map();
    if (value === null || typeof value !== 'object' || Array.isArray(value))
        throw new TypeError('managed_label_libraries must map library addresses to access-token ids');
    return new Map(Object.entries(value).map(([address, token_id]) => {
        try {
            parse_library_address(address);
        }
        catch {
            throw new TypeError(`managed_label_libraries names an invalid library address: ${address}`);
        }
        if (typeof token_id !== 'string' || !/^[0-9a-f]{12}$/.test(token_id))
            throw new TypeError(`managed_label_libraries[${address}] must be an access-token id`);
        return [address, token_id];
    }));
};
// An absolute http or https URL with an explicit port and nothing past the
// authority, returned as its origin.
const node_url_of = (value) => {
    if (value === undefined)
        return undefined;
    if (typeof value !== 'string')
        throw new TypeError('node_url must be a URL string');
    let url;
    try {
        url = new URL(value);
    }
    catch {
        throw new TypeError(`node_url is not a URL: ${value}`);
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:')
        throw new TypeError(`node_url must be http or https, not ${url.protocol}`);
    if (url.port === '')
        throw new TypeError(`node_url must name a port: ${value}`);
    if (url.pathname !== '/' || url.search !== '' || url.hash !== '' || url.username !== '' || url.password !== '')
        throw new TypeError(`node_url must have no path, query, fragment or credentials: ${value}`);
    return url.origin;
};
const local_network_advertisement_of = (value, node_url) => {
    if (value === undefined)
        return false;
    if (typeof value !== 'boolean')
        throw new TypeError('local_network_advertisement must be true or false');
    if (value && (node_url === undefined || !isIPv4(new URL(node_url).hostname)))
        throw new TypeError('local_network_advertisement requires a node_url whose host is an IPv4 address');
    return value;
};
export const load_config = async ({ config_path, port, data_dir, env = process.env } = {}) => {
    const path = config_path ?? env.RECORD_CONFIG;
    const { port: file_port, host, cors_origins, remote_listener, managed_label_libraries, node_url: file_node_url, local_network_advertisement, ...peer } = path === undefined ? {} : await read_config_file(path);
    const node_url = node_url_of(file_node_url);
    return {
        port: port_of(port ?? file_port ?? DEFAULT_PORT),
        host: typeof host === 'string' ? host : DEFAULT_HOST,
        cors_origins: cors_origins_of(cors_origins),
        remote_listener: remote_listener_of(remote_listener),
        managed_label_libraries: managed_label_libraries_of(managed_label_libraries),
        node_url,
        local_network_advertisement: local_network_advertisement_of(local_network_advertisement, node_url),
        peer: resolve_peer_config({ ...peer, data_dir: data_dir ?? peer.data_dir ?? default_data_dir() })
    };
};
