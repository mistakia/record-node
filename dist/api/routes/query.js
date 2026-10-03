// Query values after request validation, which has already coerced them to
// the spec's types and applied its defaults.
export const query_value = (req, name) => req.query[name];
// An exploded array parameter arrives as a bare string when given once.
export const query_list = (req, name) => {
    const value = query_value(req, name);
    if (value === undefined)
        return undefined;
    return Array.isArray(value) ? value : [value];
};
export const page = (req) => ({
    offset: query_value(req, 'offset') ?? 0,
    limit: query_value(req, 'limit') ?? 100
});
