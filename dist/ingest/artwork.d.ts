import type { ContentStore } from '#fabric/content-store.ts';
import type { ExtractedPicture } from './metadata.ts';
export declare const upload_artwork: ({ pictures, content_store }: {
    pictures: readonly ExtractedPicture[];
    content_store: ContentStore;
}) => Promise<string[]>;
