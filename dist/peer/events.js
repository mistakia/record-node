// The peer's event fan-out: the callbacks behind ApiPeer.subscribe.
// A handler that throws never stops the emitter or the other handlers.
export const create_event_bus = () => {
    const handlers = new Set();
    return {
        emit: (event) => {
            for (const handler of handlers) {
                try {
                    handler(event);
                }
                catch (error) {
                    process.emitWarning(`peer event handler for ${event.type} threw: ${error.message}`);
                }
            }
        },
        subscribe: (handler) => {
            handlers.add(handler);
            return () => { handlers.delete(handler); };
        }
    };
};
