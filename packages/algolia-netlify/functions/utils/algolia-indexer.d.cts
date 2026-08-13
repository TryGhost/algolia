type AlgoliaSettings = {
    appId?: string;
    apiKey?: string;
    index?: string;
};

interface Index {
    initIndex(): Promise<void>;
    setSettingsForIndex(): Promise<unknown>;
    save(fragments: Array<Record<string, unknown>>): Promise<void>;
    delete(slug: string): Promise<void>;
}

declare const IndexFactory: new (settings: AlgoliaSettings) => Index;
export = IndexFactory;
