/**
 * Slash command: /masoi
 */

import { SlashCommandBuilder } from 'discord.js';

export const data = new SlashCommandBuilder()
    .setName('masoi')
    .setDescription('Ma Sói (Werewolf) game commands')
    .addSubcommand(subcommand =>
        subcommand
            .setName('start')
            .setDescription('Tạo phòng chơi Ma Sói')
            .addStringOption(option =>
                option
                    .setName('preset')
                    .setDescription('Preset vai diễn')
                    .setRequired(false)
                    .addChoices(
                        { name: 'Basic (8-10 người)', value: 'basic' },
                        { name: 'Advanced (10-15 người)', value: 'advanced' }
                    )
            )
    )
    .addSubcommand(subcommand =>
        subcommand
            .setName('end')
            .setDescription('Kết thúc game hiện tại (chỉ host)')
    )
    .addSubcommand(subcommand =>
        subcommand
            .setName('status')
            .setDescription('Xem trạng thái game hiện tại')
    );
