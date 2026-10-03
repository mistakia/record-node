// The §6.4.2 step 3 download: stream a resolved audio URL to a file.
import { createWriteStream } from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { IngestError } from '#types/ingest.ts';
const DOWNLOAD_TIMEOUT_MS = 10 * 60 * 1000;
export const download_to_file = async ({ url, headers = {}, output_path }) => {
    let response;
    try {
        response = await fetch(url, { headers: { ...headers }, signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
    }
    catch (error) {
        throw new IngestError('download_failed', `download of the resolved audio failed: ${error.message}`);
    }
    if (!response.ok || response.body === null) {
        await response.body?.cancel();
        throw new IngestError('download_failed', `download of the resolved audio answered ${response.status}`);
    }
    try {
        await pipeline(Readable.fromWeb(response.body), createWriteStream(output_path));
    }
    catch (error) {
        throw new IngestError('download_failed', `download of the resolved audio broke off: ${error.message}`);
    }
};
