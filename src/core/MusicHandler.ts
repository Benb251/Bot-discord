import {
    AudioPlayer,
    AudioPlayerStatus,
    createAudioPlayer,
    createAudioResource,
    entersState,
    getVoiceConnection,
    joinVoiceChannel,
    VoiceConnectionStatus,
    StreamType
} from '@discordjs/voice';
import play from 'play-dl';
import ytdl from '@distube/ytdl-core';
import type { VoiceBasedChannel, TextChannel } from 'discord.js';
import { fetch } from 'undici';
const spotifyInfo = require('spotify-url-info')(fetch);
import { execSync, spawn } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';

const COOKIES_PATH = path.join(process.cwd(), 'www.youtube.com_cookies.txt');
const YTDLP_PATH = path.join(process.cwd(), 'yt-dlp.exe');

// Optimized play-dl for searching ONLY (using cleaned cookies)
async function initPlayDl() {
    try {
        if (fs.existsSync(COOKIES_PATH)) {
            console.log('[Music] Testing cookies for search...');
            // We don't setToken here as it caused header errors, 
            // yt-dlp handles the file directly.
        }
    } catch (err) {
        console.error('[Music] Failed to init play-dl:', err);
    }
}
initPlayDl();




// Simplified Track Interface
interface Track {
    url?: string;      // Direct YouTube URL (optional)
    query?: string;    // YouTube search query (fallback)
    title: string;
    duration: string;
}

// Guild Music State
interface MusicState {
    player: AudioPlayer;
    queue: Track[];
    current: Track | null;
    channel: TextChannel | null;
    lastErrorTime: number; // To prevent spam
}


const states = new Map<string, MusicState>();

/**
 * Robust YouTube search (play-dl with yt-dlp fallback)
 */
async function searchYouTube(query: string): Promise<string | null> {
    // Try play-dl first (fast)
    try {
        const search = await play.search(query, { limit: 1 });
        if (search.length > 0 && search[0].url) return search[0].url;
    } catch (err) {
        console.warn(`[Music] play-dl search failed for "${query}", trying yt-dlp...`);
    }

    // Fallback to yt-dlp (reliable)
    try {
        const result = execSync(`"${YTDLP_PATH}" "ytsearch1:${query}" --get-id`, { encoding: 'utf-8', timeout: 10000 });
        const videoId = result.trim();
        if (videoId) return `https://www.youtube.com/watch?v=${videoId}`;
    } catch (err) {
        console.error(`[Music] yt-dlp search failed for "${query}"`, err);
    }

    return null;
}

/**
 * Join a voice channel
 */
export async function joinChannel(channel: VoiceBasedChannel): Promise<boolean> {
    try {
        const connection = joinVoiceChannel({
            channelId: channel.id,
            guildId: channel.guild.id,
            adapterCreator: channel.guild.voiceAdapterCreator as any,
        });

        await entersState(connection, VoiceConnectionStatus.Ready, 20_000);
        return true;
    } catch (error) {
        console.error('[Music] Join Error:', error);
        return false;
    }
}

/**
 * Plays the next track in the queue
 */
async function processQueue(guildId: string): Promise<void> {
    const state = states.get(guildId);
    if (!state) return;

    if (state.queue.length === 0) {
        state.current = null;
        state.channel?.send('📭 Hết nhạc rồi! Thêm bài mới đi bạn ơi.');
        return;
    }

    const nextTrack = state.queue.shift()!;
    state.current = nextTrack;

    try {
        let streamUrl = nextTrack.url;

        // If it's a Spotify track with only a query, search YouTube now
        if (!streamUrl && nextTrack.query) {
            console.log(`[Music] Searching YouTube for: ${nextTrack.query}`);
            streamUrl = await searchYouTube(nextTrack.query) || undefined;
        }

        if (!streamUrl) {
            state.channel?.send(`❌ Không tìm thấy nhạc cho bài: ${nextTrack.title}`);
            return processQueue(guildId);
        }

        console.log(`[Music] Playing matching stream via yt-dlp (Optimized): ${nextTrack.title}`);

        const ytArgs = [
            streamUrl,
            '-f', 'bestaudio[ext=webm]/bestaudio/best', // Tối ưu cho streaming
            '-o', '-',
            '--no-playlist',
            '--buffer-size', '512K', // Buffer lớn để mượt hơn
            '--extractor-retries', '5',
            '--fragment-retries', '5',
            '--no-part',
            '--quiet',
            '--no-warnings'
        ];

        // Add cookies if available
        if (fs.existsSync(COOKIES_PATH)) {
            ytArgs.push('--cookies', COOKIES_PATH);
        }

        const ytProcess = spawn(YTDLP_PATH, ytArgs);

        const resource = createAudioResource(ytProcess.stdout, {
            inputType: StreamType.Arbitrary,
            inlineVolume: true
        });

        state.player.play(resource);
        state.channel?.send(`🎵 Đang phát: **${nextTrack.title}**`);

    } catch (error) {
        console.error('[Music] Stream Error:', error);

        // Prevent infinite fast loop (spam)
        const now = Date.now();
        if (now - state.lastErrorTime < 2000) {
            console.warn('[Music] Errors happening too fast, stopping auto-skip briefly.');
            state.channel?.send('⚠️ Gặp lỗi liên tục khi kết nối YouTube, vui lòng thử lại sau giây lát.');
            state.lastErrorTime = now;
            return;
        }
        state.lastErrorTime = now;

        state.channel?.send(`❌ Lỗi khi phát bài: ${nextTrack.title}`);
        setTimeout(() => processQueue(guildId), 1000); // Wait 1s before next one
    }
}

/**
 * Main play function
 */
export async function playMusic(guildId: string, query: string, channel?: TextChannel): Promise<{ success: boolean; message: string }> {
    const connection = getVoiceConnection(guildId);
    if (!connection) return { success: false, message: 'Bot chưa vào voice!' };

    try {
        let state = states.get(guildId);
        if (!state) {
            const player = createAudioPlayer();
            state = { player, queue: [], current: null, channel: channel || null, lastErrorTime: 0 };
            states.set(guildId, state);
            connection.subscribe(player);

            player.on(AudioPlayerStatus.Idle, () => {
                // Only trigger if we actually played something (not just crashed instantly)
                processQueue(guildId);
            });
            player.on('error', (err) => {
                console.error('[Music] Player Error:', err);
                const now = Date.now();
                if (now - state!.lastErrorTime > 1000) {
                    state!.lastErrorTime = now;
                    processQueue(guildId);
                }
            });
        }

        if (channel) state.channel = channel;

        // Simple Search/Parse
        let tracks: Track[] = [];

        // 1. Spotify
        if (query.includes('spotify.com/')) {
            console.log('[Music] Parsing Spotify URL...');
            try {
                const sp_tracks = await spotifyInfo.getTracks(query);
                console.log(`[Music] Found ${sp_tracks.length} tracks on Spotify`);

                for (const t of sp_tracks.slice(0, 100)) {
                    tracks.push({
                        query: `${t.name} ${t.artists?.[0]?.name || ''}`,
                        title: t.name,
                        duration: '?:??'
                    });
                }
            } catch (spErr) {
                console.error('[Music] Spotify Parser Error:', spErr);
                throw new Error('Không thể đọc dữ liệu từ Spotify!');
            }
        }
        // 2. YouTube
        else {
            const ytUrl = await searchYouTube(query);
            if (ytUrl) {
                // Get basic info to show title (still use play-dl for info as it's less likely to fail than search)
                try {
                    const info = await play.video_info(ytUrl);
                    tracks.push({
                        url: ytUrl,
                        title: info.video_details.title || 'Unknown',
                        duration: info.video_details.durationRaw
                    });
                } catch (e) {
                    tracks.push({ url: ytUrl, title: query, duration: '?:??' });
                }
            }
        }

        if (tracks.length === 0) return { success: false, message: 'Không tìm thấy kết quả!' };

        state.queue.push(...tracks);

        if (!state.current || state.player.state.status === AudioPlayerStatus.Idle) {
            processQueue(guildId);
            return { success: true, message: `🎵 Bắt đầu phát: **${tracks[0].title}**` };
        }

        return { success: true, message: `📋 Đã thêm vào hàng chờ: **${tracks[0].title}**` };

    } catch (error) {
        console.error('[Music] Play Error:', error);
        return { success: false, message: 'Có lỗi xảy ra khi tìm nhạc!' };
    }
}

export function skipTrack(guildId: string): { success: boolean; message: string } {
    const state = states.get(guildId);
    if (!state || !state.current) return { success: false, message: 'Không có gì để skip!' };
    state.player.stop();
    return { success: true, message: '⏭️ Đã skip!' };
}

export function stopMusic(guildId: string): boolean {
    const state = states.get(guildId);
    if (state) {
        state.queue = [];
        state.player.stop();
        return true;
    }
    return false;
}

export function leaveChannel(guildId: string): void {
    const connection = getVoiceConnection(guildId);
    if (connection) connection.destroy();
    states.delete(guildId);
}

export function clearQueue(guildId: string): boolean {
    const state = states.get(guildId);
    if (state && state.queue.length > 0) {
        state.queue = [];
        return true;
    }
    return false;
}

export function getQueue(guildId: string) {
    const state = states.get(guildId);
    return { current: state?.current || null, queue: state?.queue || [] };
}
