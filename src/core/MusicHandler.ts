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
import type { VoiceBasedChannel, TextChannel } from 'discord.js';
import { fetch } from 'undici';
const spotifyInfo = require('spotify-url-info')(fetch);
import { execSync, spawn } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import { AntigravityClient } from './AntigravityClient';
import { MusicDashboard } from './MusicDashboard';

let aiClient: AntigravityClient | null = null;
const COOKIES_PATH = path.join(process.cwd(), 'www.youtube.com_cookies.txt');
const YTDLP_PATH = path.join(process.cwd(), 'yt-dlp.exe');

export function initMusicAI(client: AntigravityClient) {
    aiClient = client;
}

// Optimized play-dl for searching ONLY (using cleaned cookies)
async function initPlayDl() {
    try {
        if (fs.existsSync(COOKIES_PATH)) {
            console.log('[Music] Testing cookies for search...');
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
export interface MusicState {
    player: AudioPlayer;
    queue: Track[];
    current: Track | null;
    channel: TextChannel | null;
    lastErrorTime: number;
    autoplay: boolean;
    loop: boolean;
    dashboardId?: string;
    startTime?: number; // Track when song started
}

const states = new Map<string, MusicState>();

/**
 * Send a temporary message that deletes itself after 30s
 */
async function sendTemp(channel: TextChannel | null, content: string) {
    if (!channel) return;
    try {
        const msg = await channel.send(content);
        setTimeout(() => msg.delete().catch(() => { }), 30_000);
    } catch (e) { /* Ignore */ }
}

/**
 * Robust YouTube search (play-dl with yt-dlp fallback)
 */
async function searchYouTube(query: string): Promise<string | null> {
    // Clean query (remove words like 'của', 'bài', 'phát', 'hãy') to help search
    const cleanQuery = query
        .replace(/\b(của|bài|phát|mở|nghe|hãy|bật|tại)\b/gi, '')
        .replace(/\s+/g, ' ')
        .trim();

    console.log(`[Music] Searching: "${cleanQuery}" (Raw: "${query}")`);

    // Try play-dl first (fast)
    try {
        const search = await play.search(cleanQuery, { limit: 1 });
        if (search.length > 0 && search[0].url) return search[0].url;
    } catch (err) {
        console.warn(`[Music] play-dl search failed for "${cleanQuery}", trying yt-dlp...`);
    }

    // Fallback to yt-dlp (reliable)
    try {
        const result = execSync(`"${YTDLP_PATH}" "ytsearch1:${cleanQuery}" --get-id`, { encoding: 'utf-8', timeout: 10000 });
        const videoId = result.trim();
        if (videoId) return `https://www.youtube.com/watch?v=${videoId}`;
    } catch (err) {
        console.error(`[Music] yt-dlp search failed for "${cleanQuery}"`, err);
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
        // Smart Auto-Play Logic
        if (state.autoplay && state.current && aiClient) {
            const lastTrackTitle = state.current.title;
            // Temp Message
            sendTemp(state.channel, `♾️ Hết nhạc rồi... Đang nhờ AI tìm bài có vibe giống **"${lastTrackTitle}"**...`);

            try {
                const messages = [
                    { role: 'system', content: 'You are a music DJ. User gives a song name. You reply with ONLY ONE song name that has a similar style/vibe. Do not add quotes or explanation.' },
                    { role: 'user', content: lastTrackTitle }
                ];

                let response;
                try {
                    response = await aiClient.chatCompletion(messages, 'gemini-3-flash-preview');
                } catch (err) {
                    console.warn('[Music] Auto-Play: 3.0 Flash failed, trying 2.5 Flash...');
                    response = await aiClient.chatCompletion(messages, 'gemini-2.5-flash');
                }

                const suggestion = response.choices?.[0]?.message?.content?.trim() || '';

                if (suggestion && suggestion.length > 2) {
                    console.log(`[Music] Auto-Play Suggestion: ${suggestion}`);
                    // Temp Message
                    sendTemp(state.channel, `✨ AI Suggest: **${suggestion}**`);

                    const ytUrl = await searchYouTube(suggestion);
                    if (ytUrl) {
                        try {
                            const info = await play.video_info(ytUrl);
                            state.queue.push({
                                url: ytUrl,
                                title: info.video_details.title || suggestion,
                                duration: info.video_details.durationRaw
                            });
                            processQueue(guildId);
                            return;
                        } catch (e) {
                            state.queue.push({ url: ytUrl, title: suggestion, duration: '?:??' });
                            processQueue(guildId);
                            return;
                        }
                    } else {
                        // Temp Message
                        sendTemp(state.channel, `❌ AI tìm ra bài "${suggestion}" mà không thấy link YouTube...`);
                    }
                } else {
                    // Temp Message
                    sendTemp(state.channel, '🤖 AI không nghĩ ra bài gì cả... (Trống rỗng)');
                }
            } catch (aiErr: any) {
                console.error('[Music] Auto-Play AI Error:', aiErr);
                // Temp Message
                sendTemp(state.channel, `⚠️ Lỗi AI DJ: ${aiErr.message || 'Kết nối kém'}`);
            }
        }

        state.current = null;
        MusicDashboard.destroy(state); // Clean up dashboard
        // Temp Message
        sendTemp(state.channel, '📭 Hết nhạc rồi! Thêm bài mới đi bạn ơi.');
        return;
    }

    const nextTrack = state.queue.shift()!;
    state.current = nextTrack;
    state.startTime = Date.now(); // Set start time

    try {
        let streamUrl = nextTrack.url;
        if (!streamUrl && nextTrack.query) {
            console.log(`[Music] Searching YouTube for: ${nextTrack.query}`);
            streamUrl = await searchYouTube(nextTrack.query) || undefined;
        }

        if (!streamUrl) {
            sendTemp(state.channel, `❌ Không tìm thấy nhạc cho bài: ${nextTrack.title}`);
            return processQueue(guildId);
        }

        console.log(`[Music] Playing matching stream via yt-dlp (Optimized): ${nextTrack.title}`);

        const ytArgs = [
            streamUrl,
            '-f', 'bestaudio[ext=webm]/bestaudio/best',
            '-o', '-',
            '--no-playlist',
            '--buffer-size', '512K',
            '--extractor-retries', '5',
            '--fragment-retries', '5',
            '--no-part',
            '--quiet',
            '--no-warnings'
        ];

        if (fs.existsSync(COOKIES_PATH)) {
            ytArgs.push('--cookies', COOKIES_PATH);
        }

        const ytProcess = spawn(YTDLP_PATH, ytArgs);

        const resource = createAudioResource(ytProcess.stdout, {
            inputType: StreamType.Arbitrary,
            inlineVolume: true
        });

        state.player.play(resource);

        // Use Dashboard instead of text
        MusicDashboard.sendNowPlaying(state).catch(err => {
            console.error('[Music] Dashboard Error:', err);
            sendTemp(state.channel, `🎵 Đang phát: **${nextTrack.title}**`);
        });

    } catch (error) {
        console.error('[Music] Stream Error:', error);

        const now = Date.now();
        if (now - state.lastErrorTime < 2000) {
            console.warn('[Music] Errors happening too fast, stopping auto-skip briefly.');
            sendTemp(state.channel, '⚠️ Gặp lỗi liên tục khi kết nối YouTube, vui lòng thử lại sau giây lát.');
            state.lastErrorTime = now;
            return;
        }
        state.lastErrorTime = now;

        sendTemp(state.channel, `❌ Lỗi khi phát bài: ${nextTrack.title}`);
        setTimeout(() => processQueue(guildId), 1000);
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
            state = {
                player,
                queue: [],
                current: null,
                channel: channel || null,
                lastErrorTime: 0,
                autoplay: true,
                loop: false,
                startTime: 0
            };
            states.set(guildId, state);
            connection.subscribe(player);

            player.on(AudioPlayerStatus.Idle, () => {
                const s = states.get(guildId);
                // Loop Logic
                if (s && s.loop && s.current) {
                    s.queue.unshift(s.current);
                }
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
        MusicDashboard.sendNowPlaying(state); // Update dashboard

        if (!state.current || state.player.state.status === AudioPlayerStatus.Idle) {
            processQueue(guildId);
            return { success: true, message: `⏳ Đang tải bài: **${tracks[0].title}**...` };
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
        MusicDashboard.destroy(state);
        return true;
    }
    return false;
}

export function leaveChannel(guildId: string): void {
    const connection = getVoiceConnection(guildId);
    if (connection) connection.destroy();

    const state = states.get(guildId);
    if (state) MusicDashboard.destroy(state);
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

export function toggleAutoplay(guildId: string): { success: boolean, enabled: boolean } {
    const state = states.get(guildId);
    if (state) {
        state.autoplay = !state.autoplay;
        return { success: true, enabled: state.autoplay };
    }
    return { success: false, enabled: false };
}

// Interaction Handlers
export function togglePause(guildId: string): { success: boolean, isPaused: boolean } {
    const state = states.get(guildId);
    if (!state) return { success: false, isPaused: false };

    if (state.player.state.status === AudioPlayerStatus.Playing) {
        state.player.pause();
        MusicDashboard.sendNowPlaying(state);
        return { success: true, isPaused: true };
    } else {
        state.player.unpause();
        MusicDashboard.sendNowPlaying(state);
        return { success: true, isPaused: false };
    }
}

export function toggleLoop(guildId: string): { success: boolean, enabled: boolean } {
    const state = states.get(guildId);
    if (!state) return { success: false, enabled: false };

    state.loop = !state.loop;
    MusicDashboard.sendNowPlaying(state);
    return { success: true, enabled: state.loop };
}

export function getMusicState(guildId: string): MusicState | undefined {
    return states.get(guildId);
}
