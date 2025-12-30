import {
    AudioPlayerStatus,
    createAudioPlayer,
    createAudioResource,
    entersState,
    getVoiceConnection,
    joinVoiceChannel,
    VoiceConnectionStatus,
    AudioPlayer,
    StreamType
} from '@discordjs/voice';
import { spawn } from 'child_process';
import play from 'play-dl'; // For search and playlist info only
import type { VoiceBasedChannel, TextChannel } from 'discord.js';
import ffmpegPath from 'ffmpeg-static';
import * as path from 'path';

// Configure FFmpeg path for prism-media
if (ffmpegPath) {
    process.env.FFMPEG_PATH = ffmpegPath;
    console.log('[Music] Using FFmpeg at:', ffmpegPath);
} else {
    console.log('[Music] WARNING: FFmpeg path not found from ffmpeg-static!');
}

// yt-dlp binary path
const YTDLP_PATH = path.join(process.cwd(), 'yt-dlp.exe');
console.log('[Music] Using yt-dlp at:', YTDLP_PATH);

// Track info interface
interface TrackInfo {
    url: string;
    title: string;
    duration: string;
}

// Guild music state
interface GuildMusicState {
    player: AudioPlayer;
    queue: TrackInfo[];
    currentTrack: TrackInfo | null;
    textChannel: TextChannel | null;
    loop: boolean;
}

// Store active states per guild
const guildStates = new Map<string, GuildMusicState>();

export async function joinChannel(channel: VoiceBasedChannel): Promise<boolean> {
    try {
        const connection = joinVoiceChannel({
            channelId: channel.id,
            guildId: channel.guild.id,
            adapterCreator: channel.guild.voiceAdapterCreator as any,
        });

        await entersState(connection, VoiceConnectionStatus.Ready, 30_000);
        console.log('[Music] Joined voice channel:', channel.name);
        return true;
    } catch (error) {
        console.error('[Music] Failed to join channel:', error);
        return false;
    }
}

export async function leaveChannel(guildId: string): Promise<void> {
    const connection = getVoiceConnection(guildId);
    if (connection) {
        connection.destroy();
        guildStates.delete(guildId);
        console.log('[Music] Left voice channel in guild:', guildId);
    }
}

// Parse playlist or video using play-dl for metadata only
async function parseQuery(query: string): Promise<TrackInfo[]> {
    const tracks: TrackInfo[] = [];

    try {
        // Check if it's a playlist (but not Radio Mix which often fails)
        if (query.includes('list=') && !query.includes('start_radio=1')) {
            console.log('[Music] Parsing playlist...');
            try {
                const playlist = await play.playlist_info(query, { incomplete: true });
                const videos = await playlist.all_videos();

                for (const video of videos.slice(0, 50)) {
                    const videoUrl = video.url || (video.id ? `https://www.youtube.com/watch?v=${video.id}` : null);

                    if (videoUrl) {
                        tracks.push({
                            url: videoUrl,
                            title: video.title || 'Unknown',
                            duration: video.durationRaw || '?:??'
                        });
                    }
                }
                console.log(`[Music] Found ${tracks.length} valid tracks in playlist`);
            } catch (playlistError) {
                console.log('[Music] Playlist parsing failed, trying as single video...');
                // Fallback: extract video ID from URL
                const videoMatch = query.match(/[?&]v=([^&]+)/);
                if (videoMatch) {
                    const singleUrl = `https://www.youtube.com/watch?v=${videoMatch[1]}`;
                    const info = await play.video_info(singleUrl);
                    tracks.push({
                        url: singleUrl,
                        title: info.video_details.title || 'Unknown',
                        duration: info.video_details.durationRaw || '?:??'
                    });
                }
            }
        }
        // Check if it's a video URL (or Radio Mix - play single video)
        else if (query.includes('youtube.com') || query.includes('youtu.be')) {
            // Extract clean video URL without playlist params
            let videoUrl = query;
            const videoMatch = query.match(/[?&]v=([^&]+)/);
            if (videoMatch) {
                videoUrl = `https://www.youtube.com/watch?v=${videoMatch[1]}`;
            }

            const info = await play.video_info(videoUrl);
            tracks.push({
                url: videoUrl,
                title: info.video_details.title || 'Unknown',
                duration: info.video_details.durationRaw || '?:??'
            });
        }
        // Search YouTube using yt-dlp (more reliable than play-dl)
        else {
            console.log('[Music] Searching YouTube with yt-dlp:', query);
            try {
                const { execSync } = require('child_process');
                // Use yt-dlp to search and get JSON output
                const result = execSync(`"${YTDLP_PATH}" "ytsearch:${query}" --dump-json --no-playlist -q`, {
                    encoding: 'utf-8',
                    timeout: 15000
                });

                const videoInfo = JSON.parse(result);
                if (videoInfo && videoInfo.webpage_url) {
                    tracks.push({
                        url: videoInfo.webpage_url,
                        title: videoInfo.title || 'Unknown',
                        duration: videoInfo.duration_string || '?:??'
                    });
                    console.log('[Music] Found:', videoInfo.title);
                }
            } catch (searchError) {
                console.error('[Music] yt-dlp search error:', searchError);
            }
        }
    } catch (error) {
        console.error('[Music] Parse error:', error);
    }

    return tracks;
}

// Create audio stream using yt-dlp subprocess
function createYtdlpStream(url: string) {
    console.log('[Music] Creating yt-dlp stream for:', url);

    const args = [
        '-f', 'bestaudio/best', // Use best (with video) as fallback for livestreams
        '-o', '-', // Output to stdout
        '--no-playlist',
        '--no-warnings',
        '-q', // Quiet mode
    ];

    // Add FFmpeg location if available
    if (ffmpegPath) {
        args.push('--ffmpeg-location', ffmpegPath);
    }

    args.push(url);

    const ytdlpProcess = spawn(YTDLP_PATH, args, {
        stdio: ['pipe', 'pipe', 'pipe']
    });

    ytdlpProcess.stderr.on('data', (data) => {
        console.log('[yt-dlp]', data.toString());
    });

    return ytdlpProcess.stdout;
}

// Play next track in queue
async function playNextInQueue(guildId: string): Promise<void> {
    const state = guildStates.get(guildId);
    if (!state) return;

    const connection = getVoiceConnection(guildId);
    if (!connection) return;

    // Get next track from queue
    const nextTrack = state.queue.shift();
    if (!nextTrack) {
        state.currentTrack = null;
        if (state.textChannel) {
            state.textChannel.send('📭 Queue đã hết. Dùng `@bot play <bài hát>` để thêm nhạc!');
        }
        return;
    }

    // Validate URL
    if (!nextTrack.url || !nextTrack.url.includes('youtube.com')) {
        console.log('[Music] Invalid track URL, skipping:', nextTrack.title);
        await playNextInQueue(guildId);
        return;
    }

    try {
        state.currentTrack = nextTrack;
        console.log('[Music] Streaming with yt-dlp:', nextTrack.url);

        // Use yt-dlp for streaming
        const stream = createYtdlpStream(nextTrack.url);

        const resource = createAudioResource(stream, {
            inputType: StreamType.Arbitrary,
        });

        state.player.play(resource);
        console.log('[Music] Now playing:', nextTrack.title);

        if (state.textChannel) {
            const queueLength = state.queue.length;
            state.textChannel.send(`🎵 **Đang phát:** ${nextTrack.title} [${nextTrack.duration}]\n📋 Còn ${queueLength} bài trong queue`);
        }
    } catch (error) {
        console.error('[Music] Play error:', error);
        // Try next track
        await playNextInQueue(guildId);
    }
}

// Main play function
export async function playMusic(
    guildId: string,
    query: string,
    textChannel?: TextChannel
): Promise<{ success: boolean; message: string }> {
    try {
        const connection = getVoiceConnection(guildId);
        if (!connection) {
            return { success: false, message: 'Bot chưa vào kênh voice!' };
        }

        // Parse query to get tracks
        const tracks = await parseQuery(query);
        if (tracks.length === 0) {
            return { success: false, message: 'Không tìm thấy bài hát!' };
        }

        // Get or create guild state
        let state = guildStates.get(guildId);
        if (!state) {
            const player = createAudioPlayer();
            state = {
                player,
                queue: [],
                currentTrack: null,
                textChannel: textChannel || null,
                loop: false
            };
            guildStates.set(guildId, state);
            connection.subscribe(player);

            // Handle player idle (play next)
            player.on(AudioPlayerStatus.Idle, () => {
                console.log('[Music] Track ended, playing next...');
                playNextInQueue(guildId);
            });

            player.on('error', (error) => {
                console.error('[Music] Player error:', error);
                playNextInQueue(guildId);
            });
        }

        // Update text channel
        if (textChannel) {
            state.textChannel = textChannel;
        }

        // Add tracks to queue
        state.queue.push(...tracks);

        // If not currently playing, start playing
        if (!state.currentTrack || state.player.state.status === AudioPlayerStatus.Idle) {
            await playNextInQueue(guildId);
            if (tracks.length > 1) {
                return { success: true, message: `🎵 Đã thêm ${tracks.length} bài vào queue và bắt đầu phát!` };
            }
            return { success: true, message: `🎵 Đang phát: **${tracks[0].title}**` };
        } else {
            // Already playing, just add to queue
            if (tracks.length > 1) {
                return { success: true, message: `📋 Đã thêm ${tracks.length} bài vào queue! (Đang có ${state.queue.length} bài)` };
            }
            return { success: true, message: `📋 Đã thêm vào queue: **${tracks[0].title}** (#${state.queue.length})` };
        }
    } catch (error: any) {
        console.error('[Music] Play error:', error);
        return { success: false, message: error.message };
    }
}

export function skipTrack(guildId: string): { success: boolean; message: string } {
    const state = guildStates.get(guildId);
    if (!state || !state.currentTrack) {
        return { success: false, message: 'Không có nhạc đang phát!' };
    }

    state.player.stop(); // This triggers Idle event which plays next
    return { success: true, message: `⏭️ Đã skip: ${state.currentTrack.title}` };
}

export function stopMusic(guildId: string): boolean {
    const state = guildStates.get(guildId);
    if (state) {
        state.queue = [];
        state.currentTrack = null;
        state.player.stop();
        return true;
    }
    return false;
}

export function getQueue(guildId: string): { current: TrackInfo | null; queue: TrackInfo[] } {
    const state = guildStates.get(guildId);
    return {
        current: state?.currentTrack || null,
        queue: state?.queue || []
    };
}

export function clearQueue(guildId: string): boolean {
    const state = guildStates.get(guildId);
    if (state) {
        state.queue = [];
        return true;
    }
    return false;
}

export function isPlaying(guildId: string): boolean {
    const state = guildStates.get(guildId);
    return state?.player?.state.status === AudioPlayerStatus.Playing;
}

// Export FFmpeg path for other uses
export { ffmpegPath as FFMPEG_PATH };
