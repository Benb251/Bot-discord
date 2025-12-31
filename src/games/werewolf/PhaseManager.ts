/**
 * Phase management for day/night cycles
 */

import { TextChannel, EmbedBuilder, StringSelectMenuBuilder, ActionRowBuilder, Guild, ButtonBuilder, ButtonStyle } from 'discord.js';
import { WerewolfGameState, GameStatus, GamePhase, gameStateManager } from './GameState';
import { Team, ROLES, RoleType } from './Roles';

export class PhaseManager {
    private phaseTimers: Map<string, NodeJS.Timeout> = new Map();

    /**
     * Start night phase
     */
    async startNightPhase(gameId: string, channel: TextChannel): Promise<void> {
        const game = gameStateManager.getGame(gameId);
        if (!game) return;

        game.phase = GamePhase.NIGHT;
        game.status = GameStatus.NIGHT;
        game.day++;
        game.nightActions.clear();
        game.phaseEndTime = new Date(Date.now() + game.config.nightDuration * 1000);

        const embed = new EmbedBuilder()
            .setTitle(`🌙 ĐÊM - Ngày ${game.day}`)
            .setColor(0x000080)
            .setDescription('Làng đã chìm vào giấc ngủ. Các vai diễn đặc biệt hãy thực hiện hành động của mình.')
            .addFields({
                name: '⏱️ Thời gian',
                value: `${game.config.nightDuration} giây`
            });

        await channel.send({ embeds: [embed] });

        gameStateManager.addEvent(gameId, {
            type: 'phase_night',
            timestamp: new Date(),
            description: `Night ${game.day} started`
        });

        // Send night action buttons in channel
        await this.sendNightActionButtons(gameId, channel);

        // Set timer to auto-advance to day
        this.setPhaseTimer(gameId, game.config.nightDuration, () => {
            this.startDayPhase(gameId, channel);
        });
    }

    /**
     * Send button in channel for night actions instead of DM
     */
    private async sendNightActionButtons(gameId: string, channel: TextChannel): Promise<void> {
        const game = gameStateManager.getGame(gameId);
        if (!game) return;

        const alivePlayers = gameStateManager.getAlivePlayers(gameId);

        for (const player of alivePlayers) {
            const role = ROLES[player.role];

            // Only for roles with night actions
            if (!role.canActAtNight) continue;

            // Skip Cupid if not night 1
            if (player.role === RoleType.CUPID && game.day !== 1) continue;

            const button = new ButtonBuilder()
                .setCustomId(`masoi_nightbtn_${gameId}_${player.userId}`)
                .setLabel(`${role.emoji} ${role.nameVi} - Hành động`)
                .setStyle(ButtonStyle.Primary);

            const row = new ActionRowBuilder<ButtonBuilder>().addComponents(button);

            await channel.send({
                content: `<@${player.userId}>`,
                components: [row]
            });
        }
    }

    /**
     * Send DM to players for night actions
     */
    private async sendNightActionDMs(gameId: string, guild: Guild): Promise<void> {
        const game = gameStateManager.getGame(gameId);
        if (!game) return;

        const alivePlayers = gameStateManager.getAlivePlayers(gameId);

        for (const player of alivePlayers) {
            try {
                const member = await guild.members.fetch(player.userId);
                const role = ROLES[player.role];

                // Only send DM to roles with night actions
                if (!role.canActAtNight) continue;

                const embed = new EmbedBuilder()
                    .setTitle(`🌙 ${role.emoji} Hành Động Ban Đêm`)
                    .setColor(0x000080)
                    .setDescription(`**Vai:** ${role.nameVi}\n**Kỹ năng:** ${role.descriptionVi}\n\n Chọn mục tiêu bên dưới:`);

                // Create select menu based on role
                let selectMenu: StringSelectMenuBuilder | null = null;
                const targets = alivePlayers.filter(p => p.userId !== player.userId); // Can't target self (usually)

                switch (player.role) {
                    case RoleType.WEREWOLF:
                        selectMenu = new StringSelectMenuBuilder()
                            .setCustomId(`masoi_nightaction_${gameId}_kill`)
                            .setPlaceholder('Chọn người để giết...')
                            .addOptions(
                                targets.map(p => ({
                                    label: p.username,
                                    value: p.userId,
                                    description: `Giết ${p.username}`
                                }))
                            );
                        break;

                    case RoleType.SEER:
                        selectMenu = new StringSelectMenuBuilder()
                            .setCustomId(`masoi_nightaction_${gameId}_check`)
                            .setPlaceholder('Chọn người để kiểm tra...')
                            .addOptions(
                                targets.map(p => ({
                                    label: p.username,
                                    value: p.userId,
                                    description: `Kiểm tra ${p.username}`
                                }))
                            );
                        break;

                    case RoleType.GUARD:
                        // Guard cannot protect same player twice in a row
                        const guardTargets = targets.filter(p => p.userId !== game.lastProtectedPlayer);
                        selectMenu = new StringSelectMenuBuilder()
                            .setCustomId(`masoi_nightaction_${gameId}_protect`)
                            .setPlaceholder('Chọn người để bảo vệ...')
                            .addOptions(
                                guardTargets.map(p => ({
                                    label: p.username,
                                    value: p.userId,
                                    description: `Bảo vệ ${p.username}`
                                }))
                            );
                        break;

                    case RoleType.CUPID:
                        // Cupid only acts on night 0 (first night)
                        if (game.day === 1) {
                            selectMenu = new StringSelectMenuBuilder()
                                .setCustomId(`masoi_nightaction_${gameId}_pair`)
                                .setPlaceholder('Chọn 2 người để ghép đôi...')
                                .setMinValues(2)
                                .setMaxValues(2)
                                .addOptions(
                                    targets.map(p => ({
                                        label: p.username,
                                        value: p.userId,
                                        description: `Ghép ${p.username}`
                                    }))
                                );
                        }
                        break;

                    case RoleType.WITCH:
                        // Witch sees who is being killed and can heal or poison
                        const witchState = game.witchStates.get(player.userId);
                        if (!witchState) break;

                        // Find werewolf kill target
                        const werewolfActions = Array.from(game.nightActions.values())
                            .filter(a => a.actionType === 'kill');
                        let killTarget: string | undefined;
                        if (werewolfActions.length > 0) {
                            const votes = new Map<string, number>();
                            werewolfActions.forEach(a => {
                                if (a.targetId) votes.set(a.targetId, (votes.get(a.targetId) || 0) + 1);
                            });
                            let maxVotes = 0;
                            votes.forEach((count, playerId) => {
                                if (count > maxVotes) {
                                    maxVotes = count;
                                    killTarget = playerId;
                                }
                            });
                        }

                        const witchOptions: any[] = [];

                        // Add heal option if has potion and someone is being killed
                        if (witchState.hasHealPotion && killTarget) {
                            witchOptions.push({
                                label: `💊 Cứu ${game.players.get(killTarget)?.username}`,
                                value: `heal_${killTarget}`,
                                description: 'Dùng thuốc cứu (chỉ 1 lần)'
                            });
                        }

                        // Add poison options if has poison
                        if (witchState.hasPoisonPotion) {
                            targets.forEach(p => {
                                witchOptions.push({
                                    label: `☠️ Đầu độc ${p.username}`,
                                    value: `poison_${p.userId}`,
                                    description: 'Dùng thuốc độc (chỉ 1 lần)'
                                });
                            });
                        }

                        // Add skip option
                        witchOptions.push({
                            label: '⏭️ Bỏ qua',
                            value: 'skip',
                            description: 'Không dùng thuốc đêm nay'
                        });

                        if (witchOptions.length > 0) {
                            selectMenu = new StringSelectMenuBuilder()
                                .setCustomId(`masoi_nightaction_${gameId}_witch`)
                                .setPlaceholder('Chọn hành động...')
                                .addOptions(witchOptions);
                        }
                        break;
                }

                if (selectMenu) {
                    const row = new ActionRowBuilder<StringSelectMenuBuilder>()
                        .addComponents(selectMenu);

                    await member.send({ embeds: [embed], components: [row] });
                    console.log(`[MA SÓI] Sent night action DM to ${player.username} (${role.nameVi})`);
                }
            } catch (error) {
                console.error(`[MA SÓI] Failed to send night action DM to ${player.username}:`, error);
            }
        }
    }

    async startDayPhase(gameId: string, channel: TextChannel): Promise<void> {
        const game = gameStateManager.getGame(gameId);
        if (!game) return;

        // Process night actions first
        await this.processNightActions(gameId, channel);

        game.phase = GamePhase.DAY;
        game.status = GameStatus.DAY;
        game.dayVotes.clear();
        game.phaseEndTime = new Date(Date.now() + game.config.dayDuration * 1000);

        const alivePlayers = gameStateManager.getAlivePlayers(gameId);
        const playerList = alivePlayers.map(p => `<@${p.userId}>`).join(' ');

        const embed = new EmbedBuilder()
            .setTitle(`☀️ NGÀY - Ngày ${game.day}`)
            .setColor(0xFFA500)
            .setDescription('Mặt trời đã mọc. Làng bắt đầu thảo luận và vote treo cổ.\n\n**Sử dụng menu bên dưới để vote!**')
            .addFields(
                {
                    name: '👥 Còn sống',
                    value: `${alivePlayers.length} người:\n${playerList}`
                },
                {
                    name: '⏱️ Thời gian',
                    value: `${game.config.dayDuration} giây`
                }
            );

        // Create vote select menu
        const voteMenu = new StringSelectMenuBuilder()
            .setCustomId(`masoi_dayvote_${gameId}`)
            .setPlaceholder('Chọn người để vote treo cổ...')
            .addOptions(
                [
                    ...alivePlayers.map(p => ({
                        label: p.username,
                        value: p.userId,
                        description: `Vote ${p.username}`
                    })),
                    {
                        label: '⏭️ Bỏ qua (không vote)',
                        value: 'skip',
                        description: 'Không vote ai cả'
                    }
                ]
            );

        const row = new ActionRowBuilder<StringSelectMenuBuilder>()
            .addComponents(voteMenu);

        await channel.send({ embeds: [embed], components: [row] });

        gameStateManager.addEvent(gameId, {
            type: 'phase_day',
            timestamp: new Date(),
            description: `Day ${game.day} started`
        });

        // Set timer to auto-advance to next night
        this.setPhaseTimer(gameId, game.config.dayDuration, () => {
            this.endDayPhase(gameId, channel);
        });
    }

    /**
     * Process night actions (werewolf kill, seer check, guard protect, etc.)
     */
    private async processNightActions(gameId: string, channel: TextChannel): Promise<void> {
        const game = gameStateManager.getGame(gameId);
        if (!game) return;

        let killedPlayer: string | undefined;
        const nightResults: string[] = [];

        // 1. Get werewolf kill target
        const werewolfActions = Array.from(game.nightActions.values())
            .filter(a => a.actionType === 'kill');

        if (werewolfActions.length > 0) {
            // Count votes
            const killVotes = new Map<string, number>();
            werewolfActions.forEach(action => {
                if (action.targetId) {
                    killVotes.set(action.targetId, (killVotes.get(action.targetId) || 0) + 1);
                }
            });

            // Get most voted target
            let maxVotes = 0;
            let target: string | undefined;
            killVotes.forEach((votes, playerId) => {
                if (votes > maxVotes) {
                    maxVotes = votes;
                    target = playerId;
                }
            });

            killedPlayer = target;
        }

        // 2. Check guard protection
        const protectAction = Array.from(game.nightActions.values())
            .find(a => a.actionType === 'protect');

        if (protectAction && protectAction.targetId) {
            const protectedPlayer = game.players.get(protectAction.targetId);
            if (protectedPlayer) {
                protectedPlayer.isProtected = true;
                game.lastProtectedPlayer = protectAction.targetId;
            }
        }

        // 3. Check witch heal/poison
        const healAction = Array.from(game.nightActions.values())
            .find(a => a.actionType === 'heal');
        const poisonAction = Array.from(game.nightActions.values())
            .find(a => a.actionType === 'poison');

        // If healed, cancel kill
        if (healAction && healAction.targetId === killedPlayer) {
            killedPlayer = undefined;
            nightResults.push('🎭 Phù Thủy đã cứu sống một người!');
        }

        // Apply poison
        if (poisonAction && poisonAction.targetId) {
            const poisonedPlayer = game.players.get(poisonAction.targetId);
            if (poisonedPlayer && poisonedPlayer.isAlive) {
                poisonedPlayer.isAlive = false;
                nightResults.push(`💀 ${poisonedPlayer.username} đã bị Phù Thủy đầu độc!`);
            }
        }

        // 4. Execute kill (if not protected or healed)
        if (killedPlayer) {
            const victim = game.players.get(killedPlayer);
            if (victim) {
                if (victim.isProtected) {
                    victim.isProtected = false; // Reset protection
                    nightResults.push('🛡️ Bảo Vệ đã cứu sống một người!');
                } else {
                    victim.isAlive = false;
                    nightResults.push(`💀 ${victim.username} đã chết đêm qua!`);

                    // Check cupid pair
                    if (victim.pairedWith) {
                        const pair = game.players.get(victim.pairedWith);
                        if (pair && pair.isAlive) {
                            pair.isAlive = false;
                            nightResults.push(`💘 ${pair.username} cũng chết theo (Cupid pair)!`);
                        }
                    }
                }
            }
        } else if (werewolfActions.length > 0) {
            nightResults.push('✨ Không có ai chết đêm qua!');
        }

        // Send results
        if (nightResults.length > 0) {
            const embed = new EmbedBuilder()
                .setTitle('🌅 Kết Quả Đêm Qua')
                .setColor(0xFF6B6B)
                .setDescription(nightResults.join('\n'));

            await channel.send({ embeds: [embed] });
        }

        // Reset protections
        game.players.forEach(p => p.isProtected = false);
    }

    /**
     * End day phase and process votes
     */
    private async endDayPhase(gameId: string, channel: TextChannel): Promise<void> {
        const game = gameStateManager.getGame(gameId);
        if (!game) return;

        // Count votes
        const voteCounts = new Map<string, number>();
        game.dayVotes.forEach(vote => {
            voteCounts.set(vote.targetId, (voteCounts.get(vote.targetId) || 0) + 1);
        });

        let maxVotes = 0;
        let eliminated: string | undefined;

        voteCounts.forEach((votes, playerId) => {
            if (votes > maxVotes) {
                maxVotes = votes;
                eliminated = playerId;
            }
        });

        if (eliminated && maxVotes > 0) {
            const victim = game.players.get(eliminated);
            if (victim) {
                victim.isAlive = false;

                const embed = new EmbedBuilder()
                    .setTitle('⚖️ Kết Quả Vote')
                    .setColor(0xFF0000)
                    .setDescription(`💀 ${victim.username} đã bị treo cổ với ${maxVotes} votes!`);

                await channel.send({ embeds: [embed] });

                // Check cupid pair
                if (victim.pairedWith) {
                    const pair = game.players.get(victim.pairedWith);
                    if (pair && pair.isAlive) {
                        pair.isAlive = false;
                        await channel.send(`💘 ${pair.username} cũng chết theo (Cupid pair)!`);
                    }
                }
            }
        } else {
            await channel.send('Không có ai bị treo cổ (không đủ votes).');
        }

        // Check win condition
        const winner = this.checkWinCondition(gameId);
        if (winner) {
            await this.endGame(gameId, channel, winner);
        } else {
            // Continue to next night
            await this.startNightPhase(gameId, channel);
        }
    }

    /**
     * Check win condition
     */
    private checkWinCondition(gameId: string): Team | null {
        const game = gameStateManager.getGame(gameId);
        if (!game) return null;

        const werewolves = gameStateManager.getAlivePlayersByTeam(gameId, Team.WEREWOLF);
        const villagers = gameStateManager.getAlivePlayersByTeam(gameId, Team.VILLAGE);

        if (werewolves.length === 0) {
            return Team.VILLAGE; // Village wins
        }

        if (werewolves.length >= villagers.length) {
            return Team.WEREWOLF; // Werewolves win
        }

        return null; // Game continues
    }

    /**
     * End game
     */
    private async endGame(gameId: string, channel: TextChannel, winner: Team): Promise<void> {
        const game = gameStateManager.getGame(gameId);
        if (!game) return;

        game.status = GameStatus.ENDED;

        const winnerEmoji = winner === Team.WEREWOLF ? '🐺' : '👤';
        const winnerName = winner === Team.WEREWOLF ? 'Ma Sói' : 'Dân Làng';

        const embed = new EmbedBuilder()
            .setTitle(`${winnerEmoji} ${winnerName.toUpperCase()} THẮNG!`)
            .setColor(winner === Team.WEREWOLF ? 0x8B0000 : 0x32CD32)
            .setDescription('Game đã kết thúc!');

        // Show all roles
        const roleReveal = Array.from(game.players.values()).map(p => {
            const status = p.isAlive ? '✅' : '💀';
            return `${status} ${p.username}: ${ROLES[p.role].emoji} ${ROLES[p.role].nameVi}`;
        }).join('\n');

        embed.addFields({ name: 'Vai Diễn', value: roleReveal });

        await channel.send({ embeds: [embed] });

        // Clear timer
        const timer = this.phaseTimers.get(gameId);
        if (timer) {
            clearTimeout(timer);
            this.phaseTimers.delete(gameId);
        }
    }

    /**
     * Set phase timer
     */
    private setPhaseTimer(gameId: string, seconds: number, callback: () => void): void {
        // Clear existing timer
        const existingTimer = this.phaseTimers.get(gameId);
        if (existingTimer) {
            clearTimeout(existingTimer);
        }

        // Set new timer
        const timer = setTimeout(callback, seconds * 1000);
        this.phaseTimers.set(gameId, timer);
    }
}

// Singleton
export const phaseManager = new PhaseManager();
