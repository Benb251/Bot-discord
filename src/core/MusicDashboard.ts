import {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    EmbedBuilder,
    Message,
    TextChannel,
    ComponentType,
    ColorResolvable
} from 'discord.js';
import { MusicState } from './MusicHandler';

export class MusicDashboard {
    /**
     * Send or Update the Music Dashboard
     */
    static async sendNowPlaying(state: MusicState): Promise<void> {
        if (!state.current || !state.channel) return;

        try {
            // Validate Data
            const title = state.current.title ? state.current.title.substring(0, 256) : 'Unknown Track';
            const url = state.current.url && state.current.url.startsWith('http') ? state.current.url : 'https://www.youtube.com';
            const durationStr = state.current.duration || '00:00';
            const thumb = this.getThumbnail(url);

            // Calculate Progress
            let elapsedSec = 0;
            if (state.startTime && state.player.state.status === 'playing') {
                elapsedSec = Math.floor((Date.now() - state.startTime) / 1000);
            }

            // Parse duration "MM:SS" -> seconds
            const durationParts = durationStr.split(':').map(Number);
            let totalSec = 0;
            if (durationParts.length === 2) totalSec = durationParts[0] * 60 + durationParts[1];
            else if (durationParts.length === 3) totalSec = durationParts[0] * 3600 + durationParts[1] * 60 + durationParts[2];

            if (totalSec === 0) totalSec = 1; // Prevent div/0

            // Cap elapsed (e.g. paused) - Not perfect handling for pause yet but better than 00:00
            if (elapsedSec > totalSec) elapsedSec = totalSec;

            // Generate Bar
            const totalBars = 15;
            const progress = Math.round((elapsedSec / totalSec) * totalBars);
            const bar = '━'.repeat(progress) + '🔘' + '─'.repeat(Math.max(0, totalBars - progress));

            const elapsedFmt = new Date(elapsedSec * 1000).toISOString().substr(14, 5);

            // 🎶 01:20 ━━🔘────────── 03:45
            const progressBar = `\`${elapsedFmt}\` ${bar} \`${durationStr}\``;

            // Create Embed
            const embed = new EmbedBuilder()
                .setColor(0x1DB954 as ColorResolvable) // Spotify Green
                // .setAuthor({ name: 'Now Playing', iconURL: 'https://upload.wikimedia.org/wikipedia/commons/thumb/1/19/Spotify_logo_without_text.svg/1024px-Spotify_logo_without_text.svg.png' })
                .setTitle(title)
                .setURL(url)
                .setDescription(progressBar)
                .setThumbnail(thumb)
                .addFields(
                    { name: 'Request', value: 'User', inline: true },
                    { name: 'Loop', value: state.loop ? 'On' : 'Off', inline: true },
                    { name: 'Queue', value: `${state.queue.length}`, inline: true }
                )
                .setFooter({ text: state.autoplay ? '✨ Autoplay On' : '⚫ Autoplay Off' });

            // Create Buttons
            const r1 = new ActionRowBuilder<ButtonBuilder>()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId('music_pause_resume')
                        .setEmoji(state.player.state.status === 'paused' ? '▶️' : '⏸️')
                        .setStyle(state.player.state.status === 'paused' ? ButtonStyle.Success : ButtonStyle.Secondary),

                    new ButtonBuilder()
                        .setCustomId('music_skip')
                        .setEmoji('⏭️')
                        .setStyle(ButtonStyle.Secondary),

                    new ButtonBuilder()
                        .setCustomId('music_stop')
                        .setEmoji('⏹️')
                        .setStyle(ButtonStyle.Danger),

                    new ButtonBuilder()
                        .setCustomId('music_loop')
                        .setEmoji('🔁')
                        .setStyle(state.loop ? ButtonStyle.Success : ButtonStyle.Secondary),

                    new ButtonBuilder()
                        .setCustomId('music_save')
                        .setEmoji('💾')
                        .setStyle(ButtonStyle.Secondary)
                );

            if (state.dashboardId) {
                try {
                    const lastMsg = await state.channel.messages.fetch(state.dashboardId).catch(() => null);
                    if (lastMsg) {
                        await lastMsg.edit({ embeds: [embed], components: [r1] });
                        return;
                    }
                } catch (e) {
                    state.dashboardId = undefined;
                }
            }

            const msg = await state.channel.send({ embeds: [embed], components: [r1] });
            state.dashboardId = msg.id;

        } catch (error) {
            console.error('[MusicDashboard] Send Error:', error);
            throw error;
        }
    }

    static async destroy(state: MusicState): Promise<void> {
        if (state.channel && state.dashboardId) {
            try {
                const msg = await state.channel.messages.fetch(state.dashboardId).catch(() => null);
                if (msg) await msg.delete();
            } catch (error) { }
            state.dashboardId = undefined;
        }
    }

    private static getThumbnail(url: string): string {
        try {
            const videoId = url.split('v=')[1]?.split('&')[0];
            if (videoId) return `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`;
        } catch (e) { }
        return 'https://i.imgur.com/5w2G84D.png';
    }
}
