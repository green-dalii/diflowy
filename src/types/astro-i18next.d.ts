declare module 'astro-i18next' {
    export function localizePath(path: string, language?: string): string;
    export function localizeUrl(url: string, language?: string): string;
}