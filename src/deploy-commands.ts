import { REST, Routes, SlashCommandBuilder } from 'discord.js';
import * as dotenv from 'dotenv';

dotenv.config();

const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.DISCORD_CLIENT_ID; // We need to ask user for this, or fetch it dynamically if possible (but REST needs it). 
// Actually, we can't fetch it dynamically easily without logging in.
// Best to ask user for CLIENT_ID or get it from the bot token (base64 decode first part) but easier to ask.
// Wait, we can get Application ID from the Developer Portal where user got the token.

if (!DISCORD_TOKEN) {
    console.error("Missing DISCORD_TOKEN in .env");
    process.exit(1);
}

// Commands Definition
const commands = [
    new SlashCommandBuilder()
        .setName('senior')
        .setDescription('Hỏi Senior Lead (Kỹ thuật chuyên sâu)')
        .addStringOption(option =>
            option.setName('question')
                .setDescription('Câu hỏi của bạn')
                .setRequired(true)),

    new SlashCommandBuilder()
        .setName('intern')
        .setDescription('Hỏi Thực tập sinh (Vui vẻ, xã giao)')
        .addStringOption(option =>
            option.setName('question')
                .setDescription('Câu hỏi của bạn')
                .setRequired(true)),

    new SlashCommandBuilder()
        .setName('curator')
        .setDescription('Tóm tắt nội dung cuộc trò chuyện gần đây')
        .addIntegerOption(option =>
            option.setName('limit')
                .setDescription('Số lượng tin nhắn cần đọc (tối đa 100)')
                .setMinValue(10)
                .setMaxValue(100)),

    new SlashCommandBuilder()
        .setName('vision')
        .setDescription('Phân tích hình ảnh (screenshot lỗi, code, UI...)')
        .addAttachmentOption(option =>
            option.setName('image')
                .setDescription('Ảnh cần phân tích')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('question')
                .setDescription('Câu hỏi về ảnh (VD: "Fix lỗi này")')
                .setRequired(false)),

    // ========== ADMIN COMMANDS ==========
    new SlashCommandBuilder()
        .setName('clear-memory')
        .setDescription('🧹 Xóa bộ nhớ hội thoại của kênh/thread hiện tại'),

    new SlashCommandBuilder()
        .setName('status')
        .setDescription('📊 Xem trạng thái bot (memory, uptime, etc.)'),

    new SlashCommandBuilder()
        .setName('auto-reply')
        .setDescription('🤖 Bật/tắt chế độ tự động trả lời trong kênh này')
        .addBooleanOption(option =>
            option.setName('enabled')
                .setDescription('Bật (true) hoặc tắt (false)')
                .setRequired(true)),

    // ========== TIER 2 COMMANDS ==========
    new SlashCommandBuilder()
        .setName('analyze-file')
        .setDescription('📄 Phân tích file (PDF, TXT, code)')
        .addAttachmentOption(option =>
            option.setName('file')
                .setDescription('File cần phân tích')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('question')
                .setDescription('Câu hỏi về file')
                .setRequired(false)),

    new SlashCommandBuilder()
        .setName('run-code')
        .setDescription('▶️ Chạy code JavaScript/TypeScript')
        .addStringOption(option =>
            option.setName('code')
                .setDescription('Code cần chạy (JS/TS)')
                .setRequired(true)),

    new SlashCommandBuilder()
        .setName('schedule-summary')
        .setDescription('⏰ Thiết lập tóm tắt tự động hàng ngày')
        .addStringOption(option =>
            option.setName('time')
                .setDescription('Giờ chạy (VD: 09:00)')
                .setRequired(true))
        .addIntegerOption(option =>
            option.setName('limit')
                .setDescription('Số tin nhắn cần tóm tắt')
                .setMinValue(10)
                .setMaxValue(100)),

    // ========== TIER 3 COMMANDS ==========
    new SlashCommandBuilder()
        .setName('config')
        .setDescription('⚙️ Cấu hình bot cho server này')
        .addSubcommand(sub => sub
            .setName('view')
            .setDescription('Xem cấu hình hiện tại'))
        .addSubcommand(sub => sub
            .setName('set-memory-limit')
            .setDescription('Đặt giới hạn tin nhắn trong bộ nhớ')
            .addIntegerOption(opt => opt.setName('limit').setDescription('Số tin nhắn (10-50)').setRequired(true))),

    new SlashCommandBuilder()
        .setName('tts')
        .setDescription('🔊 Đọc tin nhắn bằng giọng nói (TTS)')
        .addStringOption(option =>
            option.setName('text')
                .setDescription('Nội dung cần đọc')
                .setRequired(true)),

    new SlashCommandBuilder()
        .setName('imagine')
        .setDescription('🎨 Tạo ảnh bằng AI (Gemini Image)')
        .addStringOption(option =>
            option.setName('prompt')
                .setDescription('Mô tả ảnh cần tạo (VD: "con mèo đang chơi piano")')
                .setRequired(true)),

    new SlashCommandBuilder()
        .setName('edit-image')
        .setDescription('✏️ Chỉnh sửa ảnh bằng AI (Image + Text → Image)')
        .addAttachmentOption(option =>
            option.setName('image')
                .setDescription('Ảnh cần chỉnh sửa')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('prompt')
                .setDescription('Mô tả thay đổi (VD: "thêm mũ cho con mèo")')
                .setRequired(true)),

    // ========== GAME COMMANDS ==========
    new SlashCommandBuilder()
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
                            { name: 'Mini (6-8 người)', value: 'mini' },
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
        ),
].map(command => command.toJSON());

const rest = new REST({ version: '10' }).setToken(DISCORD_TOKEN);

(async () => {
    try {
        console.log('Started refreshing application (/) commands.');

        // We need CLIENT_ID. 
        // Quick hack: Parse it from token if not provided? 
        // Token format: "Client_ID_Base64.Timestamp.Hmac"
        // Valid for standard tokens.

        let clientId = process.env.DISCORD_CLIENT_ID;
        if (!clientId) {
            try {
                const parts = DISCORD_TOKEN.split('.');
                if (parts.length > 1) {
                    clientId = Buffer.from(parts[0], 'base64').toString('ascii');
                    console.log(`[Auto-Detect] Client ID detected from token: ${clientId}`);
                }
            } catch (e) {
                console.error("Could not auto-detect Client ID. Please set DISCORD_CLIENT_ID in .env");
                process.exit(1);
            }
        }

        if (!clientId) {
            console.error("Client ID is missing. Please set DISCORD_CLIENT_ID in .env");
            process.exit(1);
        }

        // Use Guild Commands for instant propagation (Global takes up to 1 hour)
        const guildId = process.env.DISCORD_GUILD_ID;

        if (guildId) {
            // Guild-specific: Updates INSTANTLY
            console.log(`[Guild Mode] Deploying to guild ${guildId}...`);
            await rest.put(
                Routes.applicationGuildCommands(clientId, guildId),
                { body: commands },
            );
            console.log('Successfully reloaded GUILD (/) commands (instant).');
        } else {
            // Global: Takes up to 1 hour to propagate
            console.log('[Global Mode] DISCORD_GUILD_ID not set. Using global commands (may take up to 1 hour)...');
            await rest.put(
                Routes.applicationCommands(clientId),
                { body: commands },
            );
            console.log('Successfully reloaded GLOBAL (/) commands.');
        }

    } catch (error) {
        console.error(error);
    }
})();
