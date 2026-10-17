// The §6.4.2 step 3 download: stream a resolved audio URL to a file.
//
// The URL comes from yt-dlp, so it is untrusted: every hop, the first and
// each redirect, must reach a public address. Redirects are followed by hand
// so each hop is checked, and a named host connects through record-resolver's
// guarded_lookup, so the address checked is the address connected to.
import { createWriteStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { request as http_request } from 'node:http';
import { request as https_request } from 'node:https';
import { isIP } from 'node:net';
import { pipeline } from 'node:stream/promises';
import { address_class, guarded_lookup } from 'record-resolver';
import { IngestError } from '#types/ingest.ts';
const DOWNLOAD_TIMEOUT_MS = 10 * 60 * 1000;
const MAX_REDIRECTS = 10;
// Media hosts cut long responses (YouTube's after a minute or two), so a
// download that breaks off resumes with a Range request where it stopped.
const MAX_RESUMES = 8;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
// Credentials yt-dlp gathered for one origin are not sent to another.
const ORIGIN_BOUND_HEADERS = new Set(['authorization', 'cookie']);
const failed = (message) => new IngestError('download_failed', `download of the resolved audio ${message}`);
const get = async ({ url, headers, lookup, signal }) => {
    if (url.protocol !== 'http:' && url.protocol !== 'https:')
        throw failed(`was redirected to a non-http(s) url: ${url.href}`);
    const host = url.hostname.replace(/^\[|\]$/g, '');
    const literal_class = isIP(host) === 0 ? undefined : address_class(host);
    if (literal_class !== undefined)
        throw failed(`was refused: ${host} is a ${literal_class} address`);
    const request = url.protocol === 'https:' ? https_request : http_request;
    return await new Promise((resolve, reject) => {
        const req = request(url, { headers: { ...headers }, lookup, signal }, resolve);
        req.on('error', (error) => {
            reject(failed(error.code === 'BLOCKED_DESTINATION' ? `was refused: ${error.message}` : `failed: ${error.message}`));
        });
        req.end();
    });
};
// The final 2xx response for url, following redirects by hand.
const follow = async ({ url, headers, lookup, signal }) => {
    let current = url;
    let hop_headers = headers;
    for (let hops = 0;; hops++) {
        const response = await get({ url: current, headers: hop_headers, lookup, signal });
        const status = response.statusCode ?? 0;
        if (REDIRECT_STATUSES.has(status) && response.headers.location !== undefined) {
            response.resume();
            if (hops === MAX_REDIRECTS)
                throw failed(`redirected more than ${MAX_REDIRECTS} times`);
            const next = new URL(response.headers.location, current);
            if (next.origin !== current.origin) {
                hop_headers = Object.fromEntries(Object.entries(hop_headers).filter(([name]) => !ORIGIN_BOUND_HEADERS.has(name.toLowerCase())));
            }
            current = next;
            continue;
        }
        if (status < 200 || status > 299) {
            response.resume();
            throw failed(`answered ${status}`);
        }
        return response;
    }
};
// A resumed response must continue at exactly the byte the file ends on.
const resumes_at = (response, offset) => response.statusCode === 206 && Number(/^bytes (\d+)-/.exec(response.headers['content-range'] ?? '')?.[1]) === offset;
const file_size = async (path) => {
    try {
        return (await stat(path)).size;
    }
    catch {
        return 0;
    }
};
// lookup is a seam for tests, which serve from loopback under a public name.
export const create_download = ({ lookup = guarded_lookup } = {}) => async ({ url, headers = {}, output_path }) => {
    const signal = AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS);
    let source;
    try {
        source = new URL(url);
    }
    catch {
        throw failed(`has an invalid url: ${url}`);
    }
    let written = 0;
    for (let resumes = 0;; resumes++) {
        const range = written > 0 ? { Range: `bytes=${written}-` } : {};
        const response = await follow({ url: source, headers: { ...headers, ...range }, lookup, signal });
        if (written > 0 && !resumes_at(response, written)) {
            response.resume();
            throw failed(`broke off at byte ${written}, and the source did not resume there`);
        }
        try {
            await pipeline(response, createWriteStream(output_path, { flags: written > 0 ? 'a' : 'w' }));
            return;
        }
        catch (error) {
            if (signal.aborted || resumes === MAX_RESUMES)
                throw failed(`broke off: ${error.message}`);
            written = await file_size(output_path);
        }
    }
};
export const download_to_file = create_download();
