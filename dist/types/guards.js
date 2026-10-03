// Structural guards shared across modules.
export const is_record = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);
