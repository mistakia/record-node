// URL resolution through record-resolver (§6.4.2 step 1). A URL the resolver
// refuses as input is the caller's error; every other failure is the node's.
import { resolve_url, ResolverError } from 'record-resolver';
import { PeerError } from '#types/peer.ts';
const INPUT_ERRORS = new Set(['MISSING_URL', 'INVALID_URL', 'BLOCKED_DESTINATION', 'UNSUPPORTED_URL']);
export const create_resolver = ({ ytdlp_path } = {}) => async (url) => await resolve_url(url, ytdlp_path === undefined ? {} : { binary_path: ytdlp_path });
// The peer wraps whichever resolver it is given.
export const refuse_input_errors = (resolve) => async (url) => {
    try {
        return await resolve(url);
    }
    catch (error) {
        if (error instanceof ResolverError && INPUT_ERRORS.has(error.code))
            throw new PeerError('invalid', error.message);
        throw error;
    }
};
// The API's GET /resolve takes records as plain objects.
export const as_api_resolver = (resolve) => async (url) => (await resolve(url)).map((entry) => ({ ...entry }));
