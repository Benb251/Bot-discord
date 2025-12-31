/**
 * Main Werewolf game controller
 */

import { Guild, TextChannel, GuildMember, EmbedBuilder, ButtonBuilder, ActionRowBuilder, ButtonStyle } from 'discord.js';
import { gameStateManager, GameStatus, GameConfig, Player } from './GameState';
import { distributeRoles, ROLES, RoleType, Team } from './Roles';
import { phaseManager } from './PhaseManager';

export class WerewolfGame {
    /**
     * Create a new game lobby
     */
    static async createLobby(
        guild: Guild,
        channel: TextChannel,
        host: GuildMember,
        preset: 'mini' | 'basic' | 'advanced' = 'mini'
    ): Promise<string> {
        // Check if game already exists in this guild
        const existingGame = gameStateManager.getGameByGuild(guild.id);
        if (existingGame) {
            throw new Error('Đã có game Ma Sói đang diễn ra trong server này!');
        }

        const config: GameConfig = {
            preset,
            minPlayers: preset === 'mini' ? 6 : preset === 'basic' ? 8 : 10,
            maxPlayers: preset === 'mini' ? 8 : preset === 'basic' ? 10 : 15,
            nightDuration: 60,  // 1 minute (giảm từ 120s)
            dayDuration: 90     // 1.5 minutes (giảm từ 180s)
        };

        const gameState = gameStateManager.createGame(
            guild.id,
            channel.id,
            host.id,
            config
        );

        // Auto-add host as first player
        gameStateManager.addPlayer(gameState.id, host.id, host.user.username);

        await this.sendLobbyEmbed(channel, gameState.id);

        return gameState.id;
    }

    /**
     * Send/update lobby embed with join button
     */
    static async sendLobbyEmbed(channel: TextChannel, gameId: string): Promise<void> {
        const game = gameStateManager.getGame(gameId);
        if (!game) return;

        const players = Array.from(game.players.values());
        const playerList = players.map((p, i) => `${i + 1}. <@${p.userId}>`).join('\n');

        const embed = new EmbedBuilder()
            .setTitle('🐺 MA SÓI - Phòng Chờ')
            .setColor(0x8B4513)
            .addFields(
                { name: 'Chủ phòng', value: `<@${game.hostId}>`, inline: true },
                { name: 'Preset', value: game.config.preset === 'mini' ? 'Mini (6-8)' : game.config.preset === 'basic' ? 'Basic (8-10)' : 'Advanced (10-15)', inline: true },
                { name: '\u200b', value: '\u200b', inline: true },
                { name: `Người chơi (${players.length}/${game.config.maxPlayers})`, value: playerList || 'Chưa có người chơi' }
            );

        const joinButton = new ButtonBuilder()
            .setCustomId(`masoi_join_${gameId}`)
            .setLabel('Tham Gia')
            .setEmoji('🎮')
            .setStyle(ButtonStyle.Success);

        const leaveButton = new ButtonBuilder()
            .setCustomId(`masoi_leave_${gameId}`)
            .setLabel('Rời Phòng')
            .setEmoji('🚪')
            .setStyle(ButtonStyle.Danger);

        const startButton = new ButtonBuilder()
            .setCustomId(`masoi_start_${gameId}`)
            .setLabel('Bắt Đầu')
            .setEmoji('🎯')
            .setStyle(ButtonStyle.Primary)
            .setDisabled(players.length < game.config.minPlayers);

        const row = new ActionRowBuilder<ButtonBuilder>()
            .addComponents(joinButton, leaveButton, startButton);

        await channel.send({ embeds: [embed], components: [row] });
    }

    /**
     * Start the game
     */
    static async startGame(gameId: string, channel: TextChannel): Promise<void> {
        const game = gameStateManager.getGame(gameId);
        if (!game) throw new Error('Game not found!');

        if (game.status !== GameStatus.LOBBY) {
            throw new Error('Game đã bắt đầu!');
        }

        const playerCount = game.players.size;
        if (playerCount < game.config.minPlayers) {
            throw new Error(`Cần ít nhất ${game.config.minPlayers} người chơi!`);
        }

        // Assign roles
        const roles = distributeRoles(playerCount, game.config.preset);
        const playerIds = Array.from(game.players.keys());

        playerIds.forEach((playerId, index) => {
            const player = game.players.get(playerId)!;
            const role = roles[index];
            const roleData = ROLES[role];

            player.role = role;
            player.team = roleData.team;

            // Initialize witch state
            if (role === RoleType.WITCH) {
                game.witchStates.set(playerId, {
                    hasHealPotion: true,
                    hasPoisonPotion: true
                });
            }
        });

        // Send role DMs
        await this.sendRoleDMs(channel.guild, gameId);

        // Count roles for display
        const roleCounts = new Map<string, number>();
        playerIds.forEach((playerId, index) => {
            const role = roles[index];
            const roleName = ROLES[role].nameVi;
            roleCounts.set(roleName, (roleCounts.get(roleName) || 0) + 1);
        });

        const roleBreakdown = Array.from(roleCounts.entries())
            .map(([name, count]) => `${count}x ${name}`)
            .join(', ');

        // Show game started embed
        const embed = new EmbedBuilder()
            .setTitle('🎮 GAME BẮT ĐẦU!')
            .setColor(0x00FF00)
            .setDescription(`Các vai diễn đã được phân. Check DMs để biết vai của bạn!\n\n**Vai trong game:** ${roleBreakdown}\n\nGame sẽ bắt đầu với đêm đầu tiên...`);

        await channel.send({ embeds: [embed] });

        // Start first night
        game.day = 0;
        setTimeout(() => {
            phaseManager.startNightPhase(gameId, channel);
        }, 5000); // 5 second delay
    }

    /**
     * Send role DMs to all players
     */
    private static async sendRoleDMs(guild: Guild, gameId: string): Promise<void> {
        const game = gameStateManager.getGame(gameId);
        if (!game) return;

        for (const [playerId, player] of game.players) {
            try {
                const member = await guild.members.fetch(playerId);
                const role = ROLES[player.role];

                const embed = new EmbedBuilder()
                    .setTitle(`${role.emoji} VAI DIỄN CỦA BẠN`)
                    .setColor(player.team === Team.WEREWOLF ? 0x8B0000 : 0x0000FF)
                    .addFields(
                        { name: 'Vai', value: role.nameVi, inline: true },
                        { name: 'Team', value: player.team === Team.WEREWOLF ? '🐺 Ma Sói' : '👤 Dân Làng', inline: true },
                        { name: 'Kỹ năng', value: role.descriptionVi }
                    );

                await member.send({ embeds: [embed] });
            } catch (error) {
                console.error(`Failed to send DM to ${playerId}:`, error);
            }
        }
    }

    /**
     * Handle player join
     */
    static async handleJoin(gameId: string, userId: string, username: string): Promise<boolean> {
        const success = gameStateManager.addPlayer(gameId, userId, username);
        return success;
    }

    /**
     * Handle player leave
     */
    static async handleLeave(gameId: string, userId: string): Promise<boolean> {
        const success = gameStateManager.removePlayer(gameId, userId);
        return success;
    }

    /**
     * End game and cleanup
     */
    static async endGame(gameId: string): Promise<void> {
        // TODO: Cleanup channels
        gameStateManager.deleteGame(gameId);
    }
}
