// Use CommonJS require for spotify-url-info (doesn't have proper ES module exports)
const spotifyUrlInfo = require('spotify-url-info');
const { fetch } = require('undici');

// Initialize spotify-url-info with fetch
const spotify = spotifyUrlInfo(fetch);
const { getData, getTracks, getPreview } = spotify;

// Spotify URL types
export type SpotifyUrlType = 'track' | 'playlist' | 'album' | 'artist' | 'unknown';

// Track info from Spotify
export interface SpotifyTrackInfo {
    title: string;
    artist: string;
    album?: string;
    duration?: number;
    spotifyUrl: string;
    youtubeQuery: string; // Search query for YouTube
}

// Playlist state for lazy loading
export interface SpotifyPlaylistState {
    url: string;
    type: SpotifyUrlType;
    totalTracks: number;
    loadedTracks: SpotifyTrackInfo[];
    offset: number;
    isFullyLoaded: boolean;
    allSpotifyTracks?: any[]; // Cache of full raw Spotify track list to avoid re-fetching
}

const BATCH_SIZE = 1; // Load 1 track at a time (just-in-time loading)
const PREFETCH_THRESHOLD = 0; // Prefetch when queue is empty (current track playing)

/**
 * Detect Spotify URL type
 */
export function detectSpotifyUrl(url: string): SpotifyUrlType {
    if (!url.includes('open.spotify.com') && !url.includes('spotify:')) {
        return 'unknown';
    }

    if (url.includes('/track/') || url.includes('spotify:track:')) {
        return 'track';
    }
    if (url.includes('/playlist/') || url.includes('spotify:playlist:')) {
        return 'playlist';
    }
    if (url.includes('/album/') || url.includes('spotify:album:')) {
        return 'album';
    }
    if (url.includes('/artist/') || url.includes('spotify:artist:')) {
        return 'artist';
    }

    return 'unknown';
}

/**
 * Check if URL is a Spotify URL
 */
export function isSpotifyUrl(url: string): boolean {
    return url.includes('open.spotify.com') || url.includes('spotify:');
}

/**
 * Convert Spotify track info to YouTube search query
 */
function toYoutubeQuery(title: string, artist: string): string {
    // Clean up title - remove feat., remix indicators etc for better search
    const cleanTitle = title
        .replace(/\s*\(feat\..*?\)/gi, '')
        .replace(/\s*\[.*?\]/gi, '')
        .trim();

    // Add "official audio" to prioritize official releases
    return `${artist} ${cleanTitle} official audio`;
}

/**
 * Get single track info from Spotify URL
 */
export async function getSpotifyTrack(url: string): Promise<SpotifyTrackInfo | null> {
    try {
        const data = await getData(url, { fetch });

        if (!data || !data.name) {
            console.log('[Spotify] No data found for track');
            return null;
        }

        const artist = data.artist || 'Unknown Artist';

        return {
            title: data.name,
            artist: artist,
            album: data.album?.name,
            duration: data.duration_ms ? Math.floor(data.duration_ms / 1000) : undefined,
            spotifyUrl: url,
            youtubeQuery: toYoutubeQuery(data.name, artist)
        };
    } catch (error) {
        console.error('[Spotify] Error getting track:', error);
        return null;
    }
}

/**
 * Get tracks from Spotify playlist/album with lazy loading support
 * Returns first batch immediately, stores state for more
 */
export async function getSpotifyPlaylistTracks(
    url: string,
    offset: number = 0,
    limit: number = BATCH_SIZE,
    cachedTracks?: any[] // Optional: use cached tracks to avoid re-fetching
): Promise<{ tracks: SpotifyTrackInfo[]; total: number; hasMore: boolean; allTracks?: any[] }> {
    try {
        console.log(`[Spotify] Fetching playlist tracks (offset: ${offset}, limit: ${limit})`);

        // Use cached tracks if available, otherwise fetch all
        let allTracks = cachedTracks;
        if (!allTracks) {
            console.log('[Spotify] Loading full playlist from Spotify API (first time only)...');
            allTracks = await getTracks(url, { fetch });
        }

        if (!allTracks || allTracks.length === 0) {
            console.log('[Spotify] No tracks found in playlist');
            return { tracks: [], total: 0, hasMore: false };
        }

        const total = allTracks.length;
        const slicedTracks = allTracks.slice(offset, offset + limit);

        const tracks: SpotifyTrackInfo[] = slicedTracks.map((track: any) => {
            const artist = track.artist || 'Unknown Artist';
            return {
                title: track.name || 'Unknown',
                artist: artist,
                album: track.album?.name,
                duration: track.duration_ms ? Math.floor(track.duration_ms / 1000) : undefined,
                spotifyUrl: track.external_urls?.spotify || url,
                youtubeQuery: toYoutubeQuery(track.name || 'Unknown', artist)
            };
        });

        console.log(`[Spotify] Loaded ${tracks.length} tracks (${offset + tracks.length}/${total})`);

        return {
            tracks,
            total,
            hasMore: offset + tracks.length < total,
            allTracks: cachedTracks ? undefined : allTracks // Return allTracks only on first fetch
        };
    } catch (error) {
        console.error('[Spotify] Error getting playlist tracks:', error);
        return { tracks: [], total: 0, hasMore: false };
    }
}

/**
 * Get top tracks from Spotify artist
 */
export async function getSpotifyArtistTracks(url: string): Promise<SpotifyTrackInfo[]> {
    try {
        console.log('[Spotify] Fetching artist top tracks...');

        // For artist URLs, getData returns artist info with top tracks
        const data = await getData(url, { fetch });

        if (!data) {
            console.log('[Spotify] No data found for artist');
            return [];
        }

        // Try to get tracks from the artist data
        const tracks: SpotifyTrackInfo[] = [];
        const artistName = data.name || 'Unknown Artist';

        // If there are top tracks in the response
        if (data.tracks && Array.isArray(data.tracks)) {
            for (const track of data.tracks.slice(0, 10)) {
                tracks.push({
                    title: track.name || 'Unknown',
                    artist: artistName,
                    album: track.album?.name,
                    duration: track.duration_ms ? Math.floor(track.duration_ms / 1000) : undefined,
                    spotifyUrl: track.external_urls?.spotify || url,
                    youtubeQuery: toYoutubeQuery(track.name || 'Unknown', artistName)
                });
            }
        }

        // Fallback: try getTracks which sometimes works for artist pages
        if (tracks.length === 0) {
            try {
                const allTracks = await getTracks(url, { fetch });
                for (const track of (allTracks || []).slice(0, 10)) {
                    const artist = track.artist || artistName;
                    tracks.push({
                        title: track.name || 'Unknown',
                        artist: artist,
                        album: track.album?.name,
                        duration: track.duration_ms ? Math.floor(track.duration_ms / 1000) : undefined,
                        spotifyUrl: track.external_urls?.spotify || url,
                        youtubeQuery: toYoutubeQuery(track.name || 'Unknown', artist)
                    });
                }
            } catch (e) {
                console.log('[Spotify] getTracks fallback failed for artist');
            }
        }

        console.log(`[Spotify] Found ${tracks.length} artist tracks`);
        return tracks;
    } catch (error) {
        console.error('[Spotify] Error getting artist tracks:', error);
        return [];
    }
}

/**
 * Parse any Spotify URL and return track info(s)
 * For playlists: returns first batch + state for lazy loading
 */
export async function parseSpotifyUrl(url: string): Promise<{
    tracks: SpotifyTrackInfo[];
    playlistState?: SpotifyPlaylistState;
}> {
    const urlType = detectSpotifyUrl(url);
    console.log(`[Spotify] Parsing URL type: ${urlType}`);

    switch (urlType) {
        case 'track': {
            const track = await getSpotifyTrack(url);
            return { tracks: track ? [track] : [] };
        }

        case 'playlist':
        case 'album': {
            const result = await getSpotifyPlaylistTracks(url, 0, BATCH_SIZE);

            const playlistState: SpotifyPlaylistState | undefined = result.hasMore ? {
                url,
                type: urlType,
                totalTracks: result.total,
                loadedTracks: result.tracks,
                offset: result.tracks.length,
                isFullyLoaded: false,
                allSpotifyTracks: result.allTracks // Store full track list cache
            } : undefined;

            return { tracks: result.tracks, playlistState };
        }

        case 'artist': {
            const tracks = await getSpotifyArtistTracks(url);
            return { tracks };
        }

        default:
            console.log('[Spotify] Unknown URL type');
            return { tracks: [] };
    }
}

/**
 * Load more tracks from a playlist (for lazy loading)
 */
export async function loadMorePlaylistTracks(
    state: SpotifyPlaylistState
): Promise<{ tracks: SpotifyTrackInfo[]; hasMore: boolean }> {
    if (state.isFullyLoaded) {
        return { tracks: [], hasMore: false };
    }

    // Use cached tracks to avoid re-fetching from Spotify API
    const result = await getSpotifyPlaylistTracks(
        state.url,
        state.offset,
        BATCH_SIZE,
        state.allSpotifyTracks // Pass cached tracks
    );

    // Update state
    state.offset += result.tracks.length;
    state.loadedTracks.push(...result.tracks);
    state.isFullyLoaded = !result.hasMore;

    return { tracks: result.tracks, hasMore: result.hasMore };
}

// Export constants for use elsewhere
export { BATCH_SIZE, PREFETCH_THRESHOLD };
