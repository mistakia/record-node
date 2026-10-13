// base58btc for protocol-object CIDs, exact against multiformats' codec but
// several times faster: it carries three base58 digits per step, where the
// generic codec carries one, and every step stays in int32 arithmetic. Every
// entry hash is encoded, and every next pointer and envelope content decoded,
// when a large library opens, and the generic codec was a third of that
// open's CPU.
const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
// 58^3 < 2^18, so a remainder shifted up a byte stays below 2^26.
const CHUNK_BASE = 58 ** 3;
const ZERO_DIGIT = 49;
const DIGIT_OF = new Int8Array(128).fill(-1);
for (let index = 0; index < ALPHABET.length; index++)
    DIGIT_OF[ALPHABET.charCodeAt(index)] = index;
export const encode_base58btc = (bytes) => {
    let zeros = 0;
    while (zeros < bytes.length && bytes[zeros] === 0)
        zeros++;
    // Long division of the big-endian number by 58^3, least significant
    // digits first.
    const number = Uint8Array.from(bytes.subarray(zeros));
    const digits = [];
    let start = 0;
    while (start < number.length) {
        let remainder = 0;
        for (let index = start; index < number.length; index++) {
            const accumulated = (remainder << 8) | number[index];
            const quotient = (accumulated / CHUNK_BASE) | 0;
            number[index] = quotient;
            remainder = accumulated - quotient * CHUNK_BASE;
        }
        while (start < number.length && number[start] === 0)
            start++;
        digits.push(ALPHABET[remainder % 58], ALPHABET[((remainder / 58) | 0) % 58], ALPHABET[(remainder / 3364) | 0]);
    }
    // The most significant chunk is zero-padded; those pad digits are not
    // leading zero bytes.
    let end = digits.length;
    while (end > 0 && digits[end - 1] === '1')
        end--;
    let text = '1'.repeat(zeros);
    for (let index = end - 1; index >= 0; index--)
        text += digits[index];
    return text;
};
// The bytes, or undefined for a string with a character outside the alphabet.
export const decode_base58btc = (text) => {
    let zeros = 0;
    while (zeros < text.length && text.charCodeAt(zeros) === ZERO_DIGIT)
        zeros++;
    // Little-endian bytes of the number, multiplied up a chunk at a time; base
    // 58 needs log(58)/log(256) < 0.733 bytes per digit.
    const number = new Uint8Array(Math.ceil((text.length - zeros) * 0.733) + 1);
    let length = 0;
    const first = (text.length - zeros) % 3 || 3;
    for (let offset = zeros; offset < text.length;) {
        const width = offset === zeros ? first : 3;
        let value = 0;
        for (let position = 0; position < width; position++) {
            const code = text.charCodeAt(offset + position);
            const digit = code < 128 ? DIGIT_OF[code] : -1;
            if (digit < 0)
                return undefined;
            value = value * 58 + digit;
        }
        offset += width;
        const multiplier = width === 3 ? CHUNK_BASE : 58 ** width;
        let carry = value;
        for (let index = 0; index < length; index++) {
            const accumulated = number[index] * multiplier + carry;
            number[index] = accumulated & 255;
            carry = accumulated >>> 8;
        }
        while (carry > 0) {
            number[length++] = carry & 255;
            carry >>>= 8;
        }
    }
    const bytes = new Uint8Array(zeros + length);
    for (let index = 0; index < length; index++)
        bytes[bytes.length - 1 - index] = number[index];
    return bytes;
};
