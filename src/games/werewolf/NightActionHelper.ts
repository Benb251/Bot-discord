/**
 * Helper to build night action select menus
 */

import { StringSelectMenuBuilder } from 'discord.js';
import { WerewolfGameState, gameStateManager, Player } from './GameState';
import { RoleType, ROLES } from './Roles';

export function buildNightActionMenu(
    gameId: string,
    player: Player,
    alivePlayers: Player[]
): StringSelectMenuBuilder | null {
    const game = gameStateManager.getGame(gameId);
    if (!game) return null;

    const targets = alivePlayers.filter(p => p.userId !== player.userId);
    let selectMenu: StringSelectMenuBuilder | null = null;

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

    return selectMenu;
}
