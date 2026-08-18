declare module '@tryghost/algolia-indexer' {
    type AlgoliaSettings = {
        appId?: string;
        apiKey?: string;
        index?: string;
    };

    class IndexFactory {
        constructor(settings?: AlgoliaSettings);
        initIndex(): Promise<void>;
        setSettingsForIndex(options?: {updateSettings?: boolean}): Promise<unknown>;
        save(fragments: Array<Record<string, unknown>>): Promise<void>;
        delete(slug: string): Promise<void>;
        deleteObjects(fragments: Array<Record<string, unknown>>): Promise<void>;
    }

    export default IndexFactory;
}
