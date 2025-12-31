declare module 'spotify-url-info' {
    export function getData(url: string, options?: { fetch?: any }): Promise<any>;
    export function getTracks(url: string, options?: { fetch?: any }): Promise<any[]>;
    export function getPreview(url: string, options?: { fetch?: any }): Promise<any>;
}
