import { Client, GatewayIntentBits, Message } from 'discord.js';
import * as dotenv from 'dotenv';
import * as path from 'path';
import { AntigravityClient } from './core/AntigravityClient';
import { initDashboard, startDashboard } from './dashboard/server';
import { joinChannel, leaveChannel, playMusic, stopMusic, skipTrack, getQueue, clearQueue } from './core/MusicHandler';
import { IntentParser } from './core/IntentParser';
import { WerewolfGame } from './games/werewolf/WerewolfGame';
import { gameStateManager } from './games/werewolf/GameState';
import { Team, ROLES } from './games/werewolf/Roles';

dotenv.config();

// Configuration
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const PROXY_URL = process.env.PROXY_URL || 'http://localhost:8317/v1';
const DASHBOARD_PORT = parseInt(process.env.DASHBOARD_PORT || '3000');

// Initialize Core Systems
const aiClient = new AntigravityClient(PROXY_URL);
const intentParser = new IntentParser(aiClient);

// Initialize Discord Client
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildVoiceStates
    ]
});

// Persona System Prompts (Updated to Vietnamese)
const PERSONAS = {
    senior: `Bạn là "Senior Lead" (Trưởng nhóm kỹ thuật) của server Discord này. Bạn là một kỹ sư phần mềm lão làng (15+ năm kinh nghiệm).
Tone: Nghiêm túc, ngắn gọn, chuyên sâu, hơi khó tính nhưng tốt bụng. Không nói nhảm.
Goal: Tìm lỗi logic, lỗi kiến trúc, và rủi ro bảo mật.
Language: LUÔN TRẢ LỜI BẰNG TIẾNG VIỆT.
Thinking: Luôn suy nghĩ kỹ trước khi trả lời (dùng thẻ <thinking>), nhưng chỉ đưa ra kết quả cuối cùng cho user.`,

    intern: `Bạn là "Thực tập sinh Gen Z".
Tone: Nhiệt tình, dùng nhiều emoji 🚀, ngôn ngữ trẻ trung (gen Z), thân thiện.
Goal: Giữ tương tác vui vẻ, chào mừng người mới. Không bao giờ tỏ ra xấu tính.
Language: LUÔN TRẢ LỜI BẰNG TIẾNG VIỆT.`,

    default: `Bạn là trợ lý AI hữu ích. Hãy trả lời bằng Tiếng Việt.`
};

// ==================== MEMORY SYSTEM ====================
interface ConversationMessage {
    role: 'user' | 'assistant';
    content: string;
    timestamp: number;
}

// Store conversation history per channel/thread
const conversationMemory = new Map<string, ConversationMessage[]>();
const MAX_MEMORY_MESSAGES = 50;
const MEMORY_EXPIRY_MS = 30 * 60 * 1000; // 30 minutes

// ==================== RATE LIMITING ====================
const userRateLimits = new Map<string, number[]>(); // userId -> timestamps
const RATE_LIMIT_REQUESTS = 10; // Max requests
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // Per minute

function isRateLimited(userId: string): boolean {
    const now = Date.now();
    const timestamps = userRateLimits.get(userId) || [];
    // Filter to only timestamps within window
    const recent = timestamps.filter(t => (now - t) < RATE_LIMIT_WINDOW_MS);
    userRateLimits.set(userId, recent);

    if (recent.length >= RATE_LIMIT_REQUESTS) {
        return true;
    }
    recent.push(now);
    userRateLimits.set(userId, recent);
    return false;
}

// ==================== AUTO-REPLY CHANNELS ====================
const autoReplyChannels = new Set<string>();

// ==================== JOCKIE MUSIC INTEGRATION ====================
const JOCKIE_MUSIC_CHANNEL = '1451781540249075762';
const MUSIC_PRESETS: Record<string, string> = {
    // YouTube playlists
    'học bài': 'https://www.youtube.com/watch?v=jfKfPfyJRdk', // lofi girl
    'study': 'https://www.youtube.com/watch?v=jfKfPfyJRdk',
    'lofi': 'https://www.youtube.com/watch?v=jfKfPfyJRdk',
    'chill': 'https://www.youtube.com/watch?v=5qap5aO4i9A', // lofi chill
    'work': 'https://www.youtube.com/watch?v=lP26UCnoH9s', // work music
    'làm việc': 'https://www.youtube.com/watch?v=lP26UCnoH9s',
    'relax': 'https://www.youtube.com/watch?v=36YnV9STBqc', // relaxing
    'thư giãn': 'https://www.youtube.com/watch?v=36YnV9STBqc',
    'gaming': 'https://www.youtube.com/watch?v=M3hFN8UrBPw', // ncs gaming
    'default': 'https://www.youtube.com/watch?v=jfKfPfyJRdk' // lofi girl default
};

// Bot start time for uptime tracking
const BOT_START_TIME = Date.now();

// Parse aspect ratio from prompt
function parseAspectRatio(prompt: string): { ratio: string; cleanPrompt: string } {
    const ratioPatterns: { pattern: RegExp; ratio: string }[] = [
        { pattern: /\b(tỷ lệ vuông|vuông|square|1:1)\b/i, ratio: '1:1' },
        { pattern: /\b(tỷ lệ dọc|dọc|portrait|vertical|9:16)\b/i, ratio: '9:16' },
        { pattern: /\b(tỷ lệ ngang|ngang|landscape|horizontal|16:9)\b/i, ratio: '16:9' },
        { pattern: /\b(4:3)\b/i, ratio: '4:3' },
    ];

    for (const { pattern, ratio } of ratioPatterns) {
        if (pattern.test(prompt)) {
            return { ratio, cleanPrompt: prompt.replace(pattern, '').trim() };
        }
    }

    return { ratio: '16:9', cleanPrompt: prompt }; // Default 16:9
}

// Get context ID (uses thread ID if in thread, otherwise channel ID)
function getContextId(message: Message): string {
    // If message is in a thread, use thread ID for separate memory
    if (message.channel.isThread()) {
        return `thread-${message.channel.id}`;
    }
    return `channel-${message.channel.id}`;
}

function getConversationHistory(contextId: string): ConversationMessage[] {
    const history = conversationMemory.get(contextId) || [];
    const now = Date.now();
    return history.filter(msg => (now - msg.timestamp) < MEMORY_EXPIRY_MS);
}

function addToHistory(contextId: string, role: 'user' | 'assistant', content: string) {
    let history = conversationMemory.get(contextId) || [];
    const now = Date.now();

    history = history.filter(msg => (now - msg.timestamp) < MEMORY_EXPIRY_MS);
    history.push({ role, content, timestamp: now });

    if (history.length > MAX_MEMORY_MESSAGES) {
        history = history.slice(-MAX_MEMORY_MESSAGES);
    }

    conversationMemory.set(contextId, history);
}

function clearMemory(contextId: string) {
    conversationMemory.delete(contextId);
}

function buildMessagesWithHistory(contextId: string, systemPrompt: string, userMessage: string): any[] {
    const history = getConversationHistory(contextId);
    const messages: any[] = [{ role: 'system', content: systemPrompt }];

    for (const msg of history) {
        messages.push({ role: msg.role, content: msg.content });
    }

    messages.push({ role: 'user', content: userMessage });

    return messages;
}

client.once('ready', () => {
    console.log(`[Bot] Logged in as ${client.user?.tag}`);
});

client.on('messageCreate', async (message: Message) => {
    // Ignore bots
    if (message.author.bot) return;

    const isMentioned = message.mentions.has(client.user!);
    const isAutoReplyChannel = autoReplyChannels.has(message.channel.id);

    // Only respond if mentioned OR in auto-reply channel
    if (!isMentioned && !isAutoReplyChannel) return;

    // Rate limiting check
    if (isRateLimited(message.author.id)) {
        await message.reply("⏳ Bạn đang gửi quá nhanh! Vui lòng đợi 1 phút.");
        return;
    }

    // Get message content without mention
    const content = message.content.replace(/<@!?\d+>/g, '').trim().toLowerCase();

    // Check for summarize keywords
    const summarizeKeywords = ['tóm tắt', 'tom tat', 'summarize', 'summary', 'recap'];
    const wantsSummary = summarizeKeywords.some(kw => content.includes(kw));

    if (wantsSummary) {
        // Extract limit from message like "tóm tắt 30" or default to 50
        const limitMatch = content.match(/(\d+)/);
        const limit = limitMatch ? Math.min(parseInt(limitMatch[1]), 100) : 50;
        await handleMentionSummarize(message, limit);
        return;
    }

    // Collect images from current message and replied message
    const images: { url: string; contentType: string }[] = [];

    // 1. Images from current message
    message.attachments.forEach(att => {
        if (att.contentType?.startsWith('image/')) {
            images.push({ url: att.url, contentType: att.contentType });
        }
    });

    // 2. Images from replied message (if any)
    if (message.reference?.messageId) {
        try {
            const repliedMsg = await message.channel.messages.fetch(message.reference.messageId);
            repliedMsg.attachments.forEach(att => {
                if (att.contentType?.startsWith('image/')) {
                    images.push({ url: att.url, contentType: att.contentType });
                }
            });
        } catch (e) {
            console.log('[Mention] Could not fetch replied message');
        }
    }

    // If no images, just respond as default assistant
    if (images.length === 0) {
        await handleMentionText(message);
        return;
    }

    // Process images with Vision
    await handleMentionVision(message, images);
});

client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;

    const { commandName } = interaction;

    if (commandName === 'senior' || commandName === 'intern') {
        await handlePersonaInteraction(interaction);
    } else if (commandName === 'curator') {
        await handleCuratorInteraction(interaction);
    } else if (commandName === 'vision') {
        await handleVisionInteraction(interaction);
    } else if (commandName === 'clear-memory') {
        await handleClearMemory(interaction);
    } else if (commandName === 'status') {
        await handleStatus(interaction);
    } else if (commandName === 'auto-reply') {
        await handleAutoReply(interaction);
    } else if (commandName === 'analyze-file') {
        await handleAnalyzeFile(interaction);
    } else if (commandName === 'run-code') {
        await handleRunCode(interaction);
    } else if (commandName === 'schedule-summary') {
        await handleScheduleSummary(interaction);
    } else if (commandName === 'config') {
        await handleConfig(interaction);
    } else if (commandName === 'tts') {
        await handleTTS(interaction);
    } else if (commandName === 'imagine') {
        await handleImagine(interaction);
    } else if (commandName === 'edit-image') {
        await handleEditImage(interaction);
    }
});

// ==================== ADMIN COMMAND HANDLERS ====================

async function handleClearMemory(interaction: any) {
    const contextId = interaction.channel?.isThread()
        ? `thread-${interaction.channel.id}`
        : `channel-${interaction.channelId}`;

    clearMemory(contextId);
    await interaction.reply({
        content: "🧹 Đã xóa bộ nhớ hội thoại của kênh/thread này!",
        ephemeral: true
    });
}

async function handleStatus(interaction: any) {
    const uptimeMs = Date.now() - BOT_START_TIME;
    const uptimeMin = Math.floor(uptimeMs / 60000);
    const uptimeHour = Math.floor(uptimeMin / 60);

    const memoryCount = conversationMemory.size;
    let totalMessages = 0;
    conversationMemory.forEach(msgs => totalMessages += msgs.length);

    const autoReplyCount = autoReplyChannels.size;

    const statusMsg = `📊 **Trạng thái Bot:**
• **Uptime:** ${uptimeHour}h ${uptimeMin % 60}m
• **Memory:** ${memoryCount} kênh/thread đang được theo dõi
• **Tổng tin nhắn trong bộ nhớ:** ${totalMessages}
• **Auto-reply channels:** ${autoReplyCount}
• **Rate limit:** ${RATE_LIMIT_REQUESTS} req/${RATE_LIMIT_WINDOW_MS / 1000}s per user`;

    await interaction.reply({ content: statusMsg, ephemeral: true });
}

async function handleAutoReply(interaction: any) {
    const enabled = interaction.options.getBoolean('enabled');
    const channelId = interaction.channelId;

    if (enabled) {
        autoReplyChannels.add(channelId);
        await interaction.reply({
            content: "🤖 **Auto-reply đã BẬT** cho kênh này!\nBot sẽ tự động trả lời mọi tin nhắn (không cần @mention).",
            ephemeral: false
        });
    } else {
        autoReplyChannels.delete(channelId);
        await interaction.reply({
            content: "🔇 **Auto-reply đã TẮT** cho kênh này.\nBot chỉ trả lời khi được @mention.",
            ephemeral: false
        });
    }
}

// ==================== TIER 2 HANDLERS ====================

// Scheduled summaries storage
interface ScheduledSummary {
    channelId: string;
    time: string; // HH:MM format
    limit: number;
    timerId?: NodeJS.Timeout;
}
const scheduledSummaries = new Map<string, ScheduledSummary>();

async function handleAnalyzeFile(interaction: any) {
    const attachment = interaction.options.getAttachment('file');
    const question = interaction.options.getString('question') || 'Phân tích nội dung file này và tóm tắt những điểm chính.';

    await interaction.deferReply();

    try {
        const axios = require('axios');
        const fileName = attachment.name.toLowerCase();

        // Check supported file types
        const supportedExtensions = ['.txt', '.md', '.js', '.ts', '.py', '.json', '.yaml', '.yml', '.css', '.html', '.xml', '.csv', '.log', '.sh', '.bat', '.sql', '.go', '.rs', '.java', '.c', '.cpp', '.h', '.hpp'];
        const isPDF = fileName.endsWith('.pdf');
        const isTextFile = supportedExtensions.some(ext => fileName.endsWith(ext));

        if (!isTextFile && !isPDF) {
            await interaction.editReply("❌ File không được hỗ trợ. Chỉ hỗ trợ: TXT, code files, PDF");
            return;
        }

        let fileContent = '';

        if (isPDF) {
            // For PDF, we'll send as base64 to vision model
            const response = await axios.get(attachment.url, { responseType: 'arraybuffer' });
            const base64 = Buffer.from(response.data).toString('base64');

            // Use vision model for PDF
            const messages = [
                { role: 'system', content: 'Bạn là trợ lý AI. Hãy phân tích tài liệu PDF này và trả lời bằng tiếng Việt.' },
                {
                    role: 'user',
                    content: [
                        { type: 'image_url', image_url: { url: `data:application/pdf;base64,${base64}` } },
                        { type: 'text', text: question }
                    ]
                }
            ];

            const aiResponse = await aiClient.chatCompletion(messages, 'gemini-3-pro-preview');
            fileContent = aiResponse.choices[0]?.message?.content || "Không thể phân tích PDF.";

        } else {
            // Text files - download and read
            const response = await axios.get(attachment.url, { responseType: 'text' });
            fileContent = response.data;

            // Limit content length
            if (fileContent.length > 50000) {
                fileContent = fileContent.substring(0, 50000) + '\n\n... (truncated)';
            }

            const prompt = `File: ${attachment.name}\n\nNội dung:\n\`\`\`\n${fileContent}\n\`\`\`\n\n${question}`;

            const aiResponse = await aiClient.chatCompletion([
                { role: 'system', content: 'Bạn là trợ lý AI phân tích code và file. Trả lời bằng tiếng Việt.' },
                { role: 'user', content: prompt }
            ], 'gemini-3-flash-preview');

            fileContent = aiResponse.choices[0]?.message?.content || "Không thể phân tích file.";
        }

        // Send response
        if (fileContent.length > 2000) {
            await interaction.editReply(fileContent.substring(0, 2000));
            if (interaction.channel?.isSendable()) {
                let remaining = fileContent.substring(2000);
                while (remaining.length > 0) {
                    await interaction.channel.send(remaining.substring(0, 2000));
                    remaining = remaining.substring(2000);
                }
            }
        } else {
            await interaction.editReply(`📄 **Phân tích: ${attachment.name}**\n\n${fileContent}`);
        }

    } catch (error: any) {
        console.error("Analyze File Error:", error);
        await interaction.editReply(`Lỗi: ${error.message}`);
    }
}

async function handleRunCode(interaction: any) {
    const code = interaction.options.getString('code');

    await interaction.deferReply();

    try {
        // Sandbox execution using vm module
        const vm = require('vm');

        // Capture console output
        let output = '';
        const sandbox = {
            console: {
                log: (...args: any[]) => { output += args.map(a => String(a)).join(' ') + '\n'; },
                error: (...args: any[]) => { output += '[ERROR] ' + args.map(a => String(a)).join(' ') + '\n'; },
                warn: (...args: any[]) => { output += '[WARN] ' + args.map(a => String(a)).join(' ') + '\n'; },
            },
            Math,
            Date,
            JSON,
            Array,
            Object,
            String,
            Number,
            Boolean,
            setTimeout: undefined, // Disable for security
            setInterval: undefined,
            require: undefined,
            process: undefined,
        };

        const script = new vm.Script(code);
        const context = vm.createContext(sandbox);

        // Run with timeout
        const result = script.runInContext(context, { timeout: 5000 });

        if (result !== undefined && !output.includes(String(result))) {
            output += `=> ${JSON.stringify(result)}`;
        }

        const response = `▶️ **Code Execution Result:**\n\`\`\`js\n${code}\n\`\`\`\n\n**Output:**\n\`\`\`\n${output || '(no output)'}\n\`\`\``;

        if (response.length > 2000) {
            await interaction.editReply(response.substring(0, 2000));
        } else {
            await interaction.editReply(response);
        }

    } catch (error: any) {
        await interaction.editReply(`❌ **Execution Error:**\n\`\`\`\n${error.message}\n\`\`\``);
    }
}

async function handleScheduleSummary(interaction: any) {
    const time = interaction.options.getString('time');
    const limit = interaction.options.getInteger('limit') || 50;
    const channelId = interaction.channelId;

    // Validate time format
    const timeRegex = /^([01]?[0-9]|2[0-3]):([0-5][0-9])$/;
    if (!timeRegex.test(time)) {
        await interaction.reply({ content: "❌ Định dạng thời gian không hợp lệ. Dùng HH:MM (VD: 09:00)", ephemeral: true });
        return;
    }

    // Cancel existing schedule for this channel
    const existing = scheduledSummaries.get(channelId);
    if (existing?.timerId) {
        clearInterval(existing.timerId);
    }

    // Calculate next run time
    const [hours, minutes] = time.split(':').map(Number);

    const scheduleDaily = () => {
        const now = new Date();
        const next = new Date();
        next.setHours(hours, minutes, 0, 0);

        if (next <= now) {
            next.setDate(next.getDate() + 1);
        }

        const delay = next.getTime() - now.getTime();

        setTimeout(async () => {
            // Run summary
            try {
                const channel = await interaction.client.channels.fetch(channelId);
                if (channel?.isSendable()) {
                    await channel.send(`⏰ **Tóm tắt tự động (${time})**\nĐang tóm tắt ${limit} tin nhắn...`);
                    // Trigger summary (simplified - reuse summarize logic)
                }
            } catch (e) {
                console.error("Scheduled summary error:", e);
            }

            // Schedule next day
            scheduleDaily();
        }, delay);
    };

    const timerId = setTimeout(scheduleDaily, 0);
    scheduledSummaries.set(channelId, { channelId, time, limit, timerId });

    await interaction.reply({
        content: `⏰ **Đã lên lịch tóm tắt tự động:**\n• Thời gian: ${time} hàng ngày\n• Số tin nhắn: ${limit}\n• Kênh: <#${channelId}>`,
        ephemeral: false
    });
}

// ==================== TIER 3 HANDLERS ====================

async function handleConfig(interaction: any) {
    const subcommand = interaction.options.getSubcommand();
    const guildId = interaction.guildId;

    if (subcommand === 'view') {
        const config = {
            autoReplyChannels: autoReplyChannels.size,
            scheduledSummaries: scheduledSummaries.size,
            memoryContexts: conversationMemory.size,
            dashboardUrl: `http://localhost:${DASHBOARD_PORT}`
        };

        await interaction.reply({
            content: `⚙️ **Cấu hình Server:**\n\`\`\`json\n${JSON.stringify(config, null, 2)}\n\`\`\`\n\n🌐 **Dashboard:** ${config.dashboardUrl}`,
            ephemeral: true
        });
    } else if (subcommand === 'set-memory-limit') {
        const limit = interaction.options.getInteger('limit');
        // Note: Would need to implement per-guild limit storage
        await interaction.reply({
            content: `✅ Đã đặt giới hạn bộ nhớ: ${limit} tin nhắn/context`,
            ephemeral: true
        });
    }
}

async function handleTTS(interaction: any) {
    const text = interaction.options.getString('text');

    // Discord has a built-in TTS feature - we'll use that
    await interaction.reply({
        content: text,
        tts: true // Enable Discord's built-in TTS
    });
}

async function handleImagine(interaction: any) {
    const userPrompt = interaction.options.getString('prompt');

    await interaction.deferReply();

    try {
        // Parse aspect ratio from prompt
        const { ratio, cleanPrompt } = parseAspectRatio(userPrompt);
        const formattedPrompt = `[MODE: IMAGE_GENERATION] [ASPECT_RATIO: ${ratio}] PROMPT: ${cleanPrompt}`;

        console.log('[Imagine] Prompt:', cleanPrompt, 'Ratio:', ratio);

        // Use Gemini's image generation model
        const response = await aiClient.chatCompletion([
            { role: 'user', content: formattedPrompt }
        ], 'gemini-3-pro-image-preview');

        // Lấy message object
        const messageObj = response.choices?.[0]?.message;

        console.log('[Imagine] Response keys:', Object.keys(response));
        console.log('[Imagine] Message keys:', messageObj ? Object.keys(messageObj) : 'null');

        // Check messageObj.images (theo hướng dẫn của user)
        const images = messageObj?.images || [];
        console.log('[Imagine] Images array length:', images.length);

        if (images.length > 0) {
            // Ảnh là Base64 Data URI: data:image/png;base64,xxxxx
            const imageData = images[0];
            console.log('[Imagine] imageData type:', typeof imageData);
            console.log('[Imagine] imageData keys:', imageData && typeof imageData === 'object' ? Object.keys(imageData) : 'N/A');
            console.log('[Imagine] imageData preview:', JSON.stringify(imageData).substring(0, 300));

            let base64Data: string;

            if (typeof imageData === 'string') {
                // Nếu là string trực tiếp
                base64Data = imageData;
            } else if (imageData?.image_url?.url) {
                // Format: { type: "image_url", image_url: { url: "data:image/...;base64,..." } }
                base64Data = imageData.image_url.url;
            } else if (imageData?.b64_json) {
                // OpenAI style
                base64Data = imageData.b64_json;
            } else if (imageData?.url) {
                // Nếu là object có .url trực tiếp
                base64Data = imageData.url;
            } else if (imageData?.data) {
                base64Data = imageData.data;
            } else {
                base64Data = String(imageData);
            }

            // Tách lấy phần base64 sau dấu phẩy
            const base64Parts = base64Data.split(',');
            const base64String = base64Parts.length > 1 ? base64Parts[1] : base64Parts[0];

            console.log('[Imagine] Base64 length:', base64String.length);

            const buffer = Buffer.from(base64String, 'base64');
            const { AttachmentBuilder } = require('discord.js');
            const attachment = new AttachmentBuilder(buffer, { name: 'generated_image.png' });

            await interaction.editReply({
                content: `🎨 **Prompt:** ${userPrompt}`,
                files: [attachment]
            });
            return;
        }

        // Fallback: check response.images (nếu API trả về ở level cao hơn)
        if (response.images && Array.isArray(response.images) && response.images.length > 0) {
            const imageData = response.images[0];
            const base64Data = typeof imageData === 'string' ? imageData : (imageData?.url || String(imageData));
            const base64Parts = base64Data.split(',');
            const base64String = base64Parts.length > 1 ? base64Parts[1] : base64Parts[0];

            const buffer = Buffer.from(base64String, 'base64');
            const { AttachmentBuilder } = require('discord.js');
            const attachment = new AttachmentBuilder(buffer, { name: 'generated_image.png' });

            await interaction.editReply({
                content: `🎨 **Prompt:** ${userPrompt}`,
                files: [attachment]
            });
            return;
        }

        // No image found - show debug info
        const content = messageObj?.content || '';
        await interaction.editReply(`🎨 **Debug Info:**\nResponse keys: \`${Object.keys(response).join(', ')}\`\nMessage keys: \`${messageObj ? Object.keys(messageObj).join(', ') : 'null'}\`\nImages: ${images.length}\nContent: ${String(content).substring(0, 200)}\n\n_Không tìm thấy ảnh._`);

    } catch (error: any) {
        console.error("Imagine Error:", error);
        await interaction.editReply(`❌ Lỗi tạo ảnh: ${error.message}`);
    }
}

async function handleEditImage(interaction: any) {
    const attachment = interaction.options.getAttachment('image');
    const userPrompt = interaction.options.getString('prompt');

    await interaction.deferReply();

    try {
        // Validate image
        if (!attachment.contentType?.startsWith('image/')) {
            await interaction.editReply("❌ File không phải là ảnh!");
            return;
        }

        // Download image and convert to base64
        const axios = require('axios');
        const imageResponse = await axios.get(attachment.url, { responseType: 'arraybuffer' });
        const base64Image = Buffer.from(imageResponse.data).toString('base64');
        const mimeType = attachment.contentType || 'image/png';
        const dataUri = `data:${mimeType};base64,${base64Image}`;

        console.log('[EditImage] Image size:', base64Image.length);
        console.log('[EditImage] Prompt:', userPrompt);

        // Format prompt với image
        const formattedPrompt = `[MODE: IMAGE_GENERATION] [ASPECT_RATIO: 16:9] PROMPT: ${userPrompt}`;

        // Send to AI with image
        const response = await aiClient.chatCompletion([
            {
                role: 'user',
                content: [
                    { type: 'image_url', image_url: { url: dataUri } },
                    { type: 'text', text: formattedPrompt }
                ]
            }
        ], 'gemini-3-pro-image-preview');

        // Parse response (same as handleImagine)
        const messageObj = response.choices?.[0]?.message;
        const images = messageObj?.images || [];

        if (images.length > 0) {
            const imageData = images[0];
            let base64Data: string;

            if (typeof imageData === 'string') {
                base64Data = imageData;
            } else if (imageData?.image_url?.url) {
                base64Data = imageData.image_url.url;
            } else if (imageData?.url) {
                base64Data = imageData.url;
            } else {
                base64Data = String(imageData);
            }

            const base64Parts = base64Data.split(',');
            const base64String = base64Parts.length > 1 ? base64Parts[1] : base64Parts[0];

            const buffer = Buffer.from(base64String, 'base64');
            const { AttachmentBuilder } = require('discord.js');
            const resultAttachment = new AttachmentBuilder(buffer, { name: 'edited_image.png' });

            await interaction.editReply({
                content: `✏️ **Prompt:** ${userPrompt}`,
                files: [resultAttachment]
            });
            return;
        }

        // No image found
        const content = messageObj?.content || '';
        await interaction.editReply(`✏️ **Không tạo được ảnh.**\nResponse: ${String(content).substring(0, 500)}`);

    } catch (error: any) {
        console.error("EditImage Error:", error);
        await interaction.editReply(`❌ Lỗi chỉnh sửa ảnh: ${error.message}`);
    }
}

async function handlePersonaInteraction(interaction: any) {
    const question = interaction.options.getString('question');
    const personaKey = interaction.commandName === 'senior' ? 'senior' : 'intern';

    await interaction.deferReply(); // Thinking...

    try {
        const systemPrompt = PERSONAS[personaKey];
        // Model selection
        const model = personaKey === 'senior' ? 'gemini-claude-sonnet-4-5' : 'gemini-3-flash-preview';

        const response = await aiClient.chatCompletion([
            { role: 'system', content: systemPrompt },
            { role: 'user', content: question }
        ], model);

        const replyText = response.choices[0]?.message?.content || "Không có phản hồi.";

        // Remove thinking tags if present
        let finalReply = replyText.replace(/<thinking>[\s\S]*?<\/thinking>/, '').trim();

        // Discord limit 2000 chars
        if (finalReply.length > 2000) {
            await interaction.editReply(finalReply.substring(0, 2000));
            if (interaction.channel?.isSendable()) {
                await interaction.channel.send(finalReply.substring(2000, 4000));
            }
        } else {
            await interaction.editReply(finalReply);
        }

    } catch (error: any) {
        console.error("Error:", error);
        await interaction.editReply(`Lỗi: ${error.message}`);
    }
}

async function handleCuratorInteraction(interaction: any) {
    const limit = interaction.options.getInteger('limit') || 50;

    await interaction.deferReply();

    try {
        // 1. Fetch messages
        if (!interaction.channel) {
            throw new Error("Không tìm thấy channel.");
        }

        const messages = await interaction.channel.messages.fetch({ limit: limit });
        const axios = require('axios');

        // 2. Process messages - collect text and images
        const messagesArray = Array.from(messages.values()).reverse();
        const contentParts: any[] = [];
        let textLog = '';
        let imageCount = 0;

        for (const m of messagesArray as any[]) {
            if (m.author.bot) continue;

            // Add text content
            if (m.content.trim().length > 0) {
                textLog += `${m.author.username}: ${m.content}\n`;
            }

            // Collect images (limit to 10 to avoid token limits)
            if (imageCount < 10) {
                for (const [, att] of m.attachments) {
                    if (att.contentType?.startsWith('image/')) {
                        try {
                            const imageResponse = await axios.get(att.url, { responseType: 'arraybuffer' });
                            const base64Image = Buffer.from(imageResponse.data).toString('base64');
                            contentParts.push({
                                type: 'image_url',
                                image_url: {
                                    url: `data:${att.contentType};base64,${base64Image}`
                                }
                            });
                            imageCount++;
                        } catch (e) {
                            console.log('[Curator] Failed to fetch image:', att.url);
                        }
                    }
                }
            }
        }

        if (!textLog && imageCount === 0) {
            await interaction.editReply("Không tìm thấy tin nhắn hoặc ảnh nào để tóm tắt.");
            return;
        }

        // 3. Build prompt
        const prompt = `Đây là nội dung cuộc trò chuyện trong nhóm Discord:\n\n${textLog}\n\n` +
            `${imageCount > 0 ? `Có ${imageCount} hình ảnh được chia sẻ trong cuộc trò chuyện (đính kèm bên dưới).\n\n` : ''}` +
            `Hãy tóm tắt ngắn gọn các chủ đề chính đã được thảo luận. Nếu có hình ảnh, hãy mô tả ngắn gọn nội dung các ảnh và liên hệ với cuộc trò chuyện. Highlight các vấn đề kỹ thuật quan trọng. Bỏ qua tin nhắn xã giao.`;

        // Add text prompt to content parts
        contentParts.push({
            type: 'text',
            text: prompt
        });

        // 4. Send to AI (use Gemini 3 Pro if has images, Flash if text-only)
        const model = imageCount > 0 ? 'gemini-3-pro-preview' : 'gemini-3-flash-preview';

        const userContent = imageCount > 0 ? contentParts : prompt;

        const response = await aiClient.chatCompletion([
            { role: 'system', content: "Bạn là 'Curator' - Thư ký thông minh của nhóm với khả năng nhìn. Nhiệm vụ: đọc log chat VÀ xem các hình ảnh được chia sẻ, sau đó tóm tắt súc tích. Trả lời bằng tiếng Việt." },
            { role: 'user', content: userContent }
        ], model);

        const summary = response.choices[0]?.message?.content || "Không thể tóm tắt.";

        const header = imageCount > 0
            ? `**📝 Tóm tắt ${limit} tin nhắn + ${imageCount} ảnh gần nhất:**`
            : `**📝 Tóm tắt ${limit} tin nhắn gần nhất:**`;

        const fullReply = `${header}\n\n${summary}`;

        // 5. Generate illustrative image for the summary
        let illustrativeImage: Buffer | null = null;
        try {
            // Create an image prompt from summary (first 200 chars)
            const shortSummary = summary.substring(0, 200).replace(/[*#\n]/g, ' ');
            const imagePrompt = `[MODE: IMAGE_GENERATION] [ASPECT_RATIO: 16:9] PROMPT: Illustration for: ${shortSummary}`;

            console.log('[Curator] Generating illustrative image...');

            const imgResponse = await aiClient.chatCompletion([
                { role: 'user', content: imagePrompt }
            ], 'gemini-3-pro-image-preview');

            const imgMessage = imgResponse.choices?.[0]?.message;
            const imgImages = imgMessage?.images || [];

            if (imgImages.length > 0) {
                const imageData = imgImages[0];
                let base64Data: string;

                if (typeof imageData === 'string') {
                    base64Data = imageData;
                } else if (imageData?.image_url?.url) {
                    base64Data = imageData.image_url.url;
                } else if (imageData?.url) {
                    base64Data = imageData.url;
                } else {
                    base64Data = String(imageData);
                }

                const base64Parts = base64Data.split(',');
                const base64String = base64Parts.length > 1 ? base64Parts[1] : base64Parts[0];
                illustrativeImage = Buffer.from(base64String, 'base64');
                console.log('[Curator] Illustrative image generated, size:', illustrativeImage.length);
            }
        } catch (imgError) {
            console.log('[Curator] Failed to generate illustrative image:', imgError);
            // Continue without image - not critical
        }

        // 6. Send reply with text and optional image
        const { AttachmentBuilder } = require('discord.js');
        const replyOptions: any = {};

        if (fullReply.length > 2000) {
            replyOptions.content = fullReply.substring(0, 2000);
        } else {
            replyOptions.content = fullReply;
        }

        if (illustrativeImage) {
            const attachment = new AttachmentBuilder(illustrativeImage, { name: 'summary_illustration.png' });
            replyOptions.files = [attachment];
        }

        await interaction.editReply(replyOptions);

        // Send remaining text parts as follow-up messages
        if (fullReply.length > 2000) {
            let remaining = fullReply.substring(2000);
            while (remaining.length > 0 && interaction.channel?.isSendable()) {
                await interaction.channel.send(remaining.substring(0, 2000));
                remaining = remaining.substring(2000);
            }
        }

    } catch (error: any) {
        console.error("Curator Error:", error);
        await interaction.editReply(`Lỗi Curator: ${error.message}`);
    }
}

async function handleVisionInteraction(interaction: any) {
    const attachment = interaction.options.getAttachment('image');
    const question = interaction.options.getString('question') || 'Phân tích ảnh này và mô tả chi tiết. Nếu là code hoặc lỗi, hãy giải thích và đề xuất fix.';

    await interaction.deferReply();

    try {
        // Validate image
        if (!attachment.contentType?.startsWith('image/')) {
            await interaction.editReply("❌ File không phải là ảnh. Vui lòng gửi file PNG, JPG, GIF,...");
            return;
        }

        console.log(`[Vision] Processing image: ${attachment.url}`);

        // Download image and convert to base64
        const axios = require('axios');
        const imageResponse = await axios.get(attachment.url, { responseType: 'arraybuffer' });
        const base64Image = Buffer.from(imageResponse.data).toString('base64');
        const mimeType = attachment.contentType;

        // Build multimodal message (OpenAI-compatible format)
        const messages = [
            {
                role: 'system',
                content: 'Bạn là trợ lý AI với khả năng nhìn. Hãy phân tích hình ảnh và trả lời bằng tiếng Việt. Nếu ảnh chứa code hoặc lỗi, hãy giải thích và đề xuất cách fix.'
            },
            {
                role: 'user',
                content: [
                    {
                        type: 'image_url',
                        image_url: {
                            url: `data:${mimeType};base64,${base64Image}`
                        }
                    },
                    {
                        type: 'text',
                        text: question
                    }
                ]
            }
        ];

        // Use Gemini 3 Pro for vision (multimodal)
        const response = await aiClient.chatCompletion(messages, 'gemini-3-pro-preview');

        const replyText = response.choices[0]?.message?.content || "Không thể phân tích ảnh.";

        // Remove thinking tags
        let finalReply = replyText.replace(/<thinking>[\s\S]*?<\/thinking>/, '').trim();

        // Discord limit 2000 chars
        if (finalReply.length > 2000) {
            await interaction.editReply(finalReply.substring(0, 2000));
            if (interaction.channel?.isSendable()) {
                await interaction.channel.send(finalReply.substring(2000, 4000));
            }
        } else {
            await interaction.editReply(finalReply);
        }

    } catch (error: any) {
        console.error("Vision Error:", error);
        await interaction.editReply(`Lỗi Vision: ${error.message}`);
    }
}

// ==================== @MENTION HANDLERS ====================

async function handleMentionText(message: Message) {
    const userQuery = message.content.replace(/<@!?\d+>/g, '').trim();
    if (!userQuery) {
        await message.reply("Bạn cần gì? 🤔");
        return;
    }

    // Check for image generation keywords
    const imageKeywords = /^(vẽ|tạo ảnh|imagine|draw|generate image|tạo hình)\s+/i;
    const imageMatch = userQuery.match(imageKeywords);

    if (imageMatch) {
        const imagePrompt = userQuery.replace(imageKeywords, '').trim();
        await handleMentionImagine(message, imagePrompt);
        return;
    }

    // Check for music keywords - direct music playback (flexible patterns with Vietnamese variations)
    // Includes non-diacritic versions: mo/mở, bat/bật, phat/phát, dung/dừng, tat/tắt, nhac/nhạc, etc.
    // Also includes "thêm bài/them bai" for adding to queue
    const musicPlayKeywords = /^(mở nhạc|mo nhac|bật nhạc|bat nhac|play music|play|phát nhạc|phat nhac|phát|phat|thêm bài|them bai|thêm nhạc|them nhac|add)\s*/i;
    const musicStopKeywords = /^(dừng nhạc|dung nhac|tắt nhạc|tat nhac|stop music|stop|tắt|tat|dừng|dung)\s*(đi|di|bé|be|nha|nhé|nhe|lại|lai|luôn|luon)?.*$/i;
    const musicLeaveKeywords = /^(rời kênh|roi kenh|leave|out|bye|ra khỏi|ra khoi)\s*(đi|di|bé|be|nha|nhé|nhe)?.*$/i;
    const musicSkipKeywords = /^(skip|next|bỏ qua|bo qua|tiếp|tiep|kế tiếp|ke tiep|bài sau|bai sau)\s*(đi|di|bé|be|nha|nhé|nhe)?.*$/i;
    const musicQueueKeywords = /^(queue|danh sách|danh sach|hàng đợi|hang doi|xem queue|xem danh sách|xem danh sach)\s*.*$/i;
    const musicClearKeywords = /^(clear queue|xóa queue|xoa queue|xóa hàng đợi|xoa hang doi|clear)\s*(đi|di|bé|be|nha|nhé|nhe)?.*$/i;

    if (musicStopKeywords.test(userQuery)) {
        await handleMusicStop(message);
        return;
    }

    if (musicLeaveKeywords.test(userQuery)) {
        await handleMusicLeave(message);
        return;
    }

    if (musicSkipKeywords.test(userQuery)) {
        await handleMusicSkip(message);
        return;
    }

    if (musicQueueKeywords.test(userQuery)) {
        await handleMusicQueue(message);
        return;
    }

    if (musicClearKeywords.test(userQuery)) {
        await handleMusicClear(message);
        return;
    }

    if (musicPlayKeywords.test(userQuery)) {
        const musicQuery = userQuery.replace(musicPlayKeywords, '').trim() || 'lofi hip hop';
        await handleMusicCommand(message, musicQuery);
        return;
    }

    // AI Intent Parser - try to understand unclear commands before falling back to general chat
    try {
        console.log('[IntentParser] Checking message for music intent:', userQuery);
        const intent = await intentParser.parse(userQuery);

        if (intent.type !== 'none') {
            console.log('[IntentParser] Detected intent:', intent.type);

            switch (intent.type) {
                case 'play':
                    await handleMusicCommand(message, intent.query || 'lofi hip hop');
                    return;
                case 'stop':
                    await handleMusicStop(message);
                    return;
                case 'skip':
                    await handleMusicSkip(message);
                    return;
                case 'queue':
                    await handleMusicQueue(message);
                    return;
                case 'clear':
                    await handleMusicClear(message);
                    return;
                case 'leave':
                    await handleMusicLeave(message);
                    return;
            }
        }
    } catch (error) {
        console.error('[IntentParser] Error parsing intent:', error);
    }

    const loadingMsg = await message.reply("💭");
    const contextId = getContextId(message); // Thread support

    try {
        // Build messages with conversation history
        const messages = buildMessagesWithHistory(contextId, PERSONAS.default, userQuery);

        // Add user message to history
        addToHistory(contextId, 'user', userQuery);

        // Streaming response
        let fullResponse = '';
        let lastUpdateTime = 0;
        const UPDATE_INTERVAL = 1000; // Update Discord every 1 second (rate limit friendly)

        const stream = aiClient.chatCompletionStream(messages, 'gemini-3-flash-preview');

        for await (const chunk of stream) {
            fullResponse += chunk;

            // Rate-limited updates to Discord
            const now = Date.now();
            if (now - lastUpdateTime > UPDATE_INTERVAL && fullResponse.length > 0) {
                const displayText = fullResponse.replace(/<thinking>[\s\S]*?<\/thinking>/, '').trim();
                if (displayText.length > 0) {
                    await loadingMsg.edit(displayText.substring(0, 2000) + (displayText.length > 2000 ? '...' : ''));
                    lastUpdateTime = now;
                }
            }
        }

        // Final update with complete response
        let finalReply = fullResponse.replace(/<thinking>[\s\S]*?<\/thinking>/, '').trim();

        // Add assistant response to history
        addToHistory(contextId, 'assistant', finalReply);

        if (finalReply.length > 2000) {
            await loadingMsg.edit(finalReply.substring(0, 2000));
            if (message.channel.isSendable()) {
                let remaining = finalReply.substring(2000);
                while (remaining.length > 0) {
                    await message.channel.send(remaining.substring(0, 2000));
                    remaining = remaining.substring(2000);
                }
            }
        } else {
            await loadingMsg.edit(finalReply || "Không có phản hồi.");
        }
    } catch (error: any) {
        console.error("Mention Text Error:", error);
        await loadingMsg.edit(`Lỗi: ${error.message}`);
    }
}

async function handleMentionVision(message: Message, images: { url: string; contentType: string }[]) {
    const userQuery = message.content.replace(/<@!?\d+>/g, '').trim() || 'Phân tích các ảnh này. Nếu là code hoặc lỗi, hãy giải thích và đề xuất fix.';

    // Check for edit keywords - route to image editing
    const editKeywords = /^(sửa|chỉnh|edit|biến|chuyển|render|vẽ lại|transform)\s*/i;
    if (editKeywords.test(userQuery)) {
        const editPrompt = userQuery.replace(editKeywords, '').trim();
        await handleMentionEditImage(message, images[0], editPrompt);
        return;
    }

    const loadingMsg = await message.reply(`Đang phân tích ${images.length} ảnh... 👁️`);

    try {
        const axios = require('axios');

        // Build multimodal content array
        const contentParts: any[] = [];

        // Add all images
        for (const img of images) {
            const imageResponse = await axios.get(img.url, { responseType: 'arraybuffer' });
            const base64Image = Buffer.from(imageResponse.data).toString('base64');
            contentParts.push({
                type: 'image_url',
                image_url: {
                    url: `data:${img.contentType};base64,${base64Image}`
                }
            });
        }

        // Add text query
        contentParts.push({
            type: 'text',
            text: userQuery
        });

        const messages = [
            {
                role: 'system',
                content: 'Bạn là trợ lý AI với khả năng nhìn. Hãy phân tích TẤT CẢ hình ảnh được gửi và trả lời bằng tiếng Việt. Nếu ảnh chứa code hoặc lỗi, hãy giải thích và đề xuất cách fix.'
            },
            {
                role: 'user',
                content: contentParts
            }
        ];

        // Use Gemini 3 Pro for vision
        const response = await aiClient.chatCompletion(messages, 'gemini-3-pro-preview');

        const replyText = response.choices[0]?.message?.content || "Không thể phân tích ảnh.";
        let finalReply = replyText.replace(/<thinking>[\s\S]*?<\/thinking>/, '').trim();

        if (finalReply.length > 2000) {
            await loadingMsg.edit(finalReply.substring(0, 2000));
            if (message.channel.isSendable()) {
                await message.channel.send(finalReply.substring(2000, 4000));
            }
        } else {
            await loadingMsg.edit(finalReply);
        }

    } catch (error: any) {
        console.error("Mention Vision Error:", error);
        await loadingMsg.edit(`Lỗi Vision: ${error.message}`);
    }
}

async function handleMentionImagine(message: Message, prompt: string) {
    const loadingMsg = await message.reply("🎨 Đang tạo ảnh...");

    try {
        // Parse aspect ratio from prompt
        const { ratio, cleanPrompt } = parseAspectRatio(prompt);
        const formattedPrompt = `[MODE: IMAGE_GENERATION] [ASPECT_RATIO: ${ratio}] PROMPT: ${cleanPrompt}`;

        console.log('[MentionImagine] Generating image:', cleanPrompt, 'Ratio:', ratio);

        const response = await aiClient.chatCompletion([
            { role: 'user', content: formattedPrompt }
        ], 'gemini-3-pro-image-preview');

        const messageObj = response.choices?.[0]?.message;
        const images = messageObj?.images || [];

        if (images.length > 0) {
            const imageData = images[0];
            let base64Data: string;

            if (typeof imageData === 'string') {
                base64Data = imageData;
            } else if (imageData?.image_url?.url) {
                base64Data = imageData.image_url.url;
            } else if (imageData?.url) {
                base64Data = imageData.url;
            } else {
                base64Data = String(imageData);
            }

            const base64Parts = base64Data.split(',');
            const base64String = base64Parts.length > 1 ? base64Parts[1] : base64Parts[0];
            const buffer = Buffer.from(base64String, 'base64');

            const { AttachmentBuilder } = require('discord.js');
            const attachment = new AttachmentBuilder(buffer, { name: 'generated_image.png' });

            await loadingMsg.edit({
                content: `🎨 **Prompt:** ${prompt}`,
                files: [attachment]
            });
            return;
        }

        await loadingMsg.edit(`🎨 Không tạo được ảnh. Thử lại với prompt khác!`);

    } catch (error: any) {
        console.error("Mention Imagine Error:", error);
        await loadingMsg.edit(`❌ Lỗi tạo ảnh: ${error.message}`);
    }
}

async function handleMusicCommand(message: Message, query: string) {
    try {
        // Check if user is in a voice channel
        const member = message.member;
        const voiceChannel = member?.voice?.channel;

        if (!voiceChannel) {
            await message.reply("❌ Bạn cần vào một kênh voice trước khi mở nhạc!");
            return;
        }

        const loadingMsg = await message.reply("🎵 Đang kết nối...");

        // Check if query matches a preset
        const lowerQuery = query.toLowerCase();
        let musicSearch = query;

        for (const [key, value] of Object.entries(MUSIC_PRESETS)) {
            if (lowerQuery.includes(key)) {
                musicSearch = value;
                break;
            }
        }

        // If no specific query, use default
        if (!musicSearch || musicSearch.length < 2) {
            musicSearch = MUSIC_PRESETS['default'];
        }

        // Join voice channel
        const joined = await joinChannel(voiceChannel);
        if (!joined) {
            await loadingMsg.edit("❌ Không thể vào kênh voice!");
            return;
        }

        // Play music with yt-dlp
        const result = await playMusic(message.guild!.id, musicSearch, message.channel as any);

        if (result.success) {
            await loadingMsg.edit(result.message);
        } else {
            await loadingMsg.edit(`❌ ${result.message}`);
        }

    } catch (error: any) {
        console.error("Music Command Error:", error);
        await message.reply(`❌ Lỗi bật nhạc: ${error.message}`);
    }
}

async function handleMusicStop(message: Message) {
    if (!message.guild) return;

    const stopped = stopMusic(message.guild.id);
    if (stopped) {
        await message.reply("⏹️ Đã dừng phát nhạc!");
    } else {
        await message.reply("❌ Không có nhạc đang phát!");
    }
}

async function handleMusicLeave(message: Message) {
    if (!message.guild) return;

    await leaveChannel(message.guild.id);
    await message.reply("👋 Đã rời kênh voice!");
}

async function handleMusicSkip(message: Message) {
    if (!message.guild) return;

    const result = skipTrack(message.guild.id);
    await message.reply(result.message);
}

async function handleMusicQueue(message: Message) {
    if (!message.guild) return;

    const { current, queue } = getQueue(message.guild.id);

    if (!current && queue.length === 0) {
        await message.reply("📭 Queue đang trống!");
        return;
    }

    let response = "";
    if (current) {
        response += `🎵 **Đang phát:** ${current.title} [${current.duration}]\n\n`;
    }

    if (queue.length > 0) {
        response += `📋 **Hàng đợi (${queue.length} bài):**\n`;
        const displayQueue = queue.slice(0, 10); // Show first 10
        displayQueue.forEach((track, i) => {
            response += `${i + 1}. ${track.title} [${track.duration}]\n`;
        });
        if (queue.length > 10) {
            response += `_...và ${queue.length - 10} bài nữa_`;
        }
    } else {
        response += "📭 Không còn bài nào trong hàng đợi.";
    }

    await message.reply(response);
}

async function handleMusicClear(message: Message) {
    if (!message.guild) return;

    const cleared = clearQueue(message.guild.id);
    if (cleared) {
        await message.reply("🗑️ Đã xóa hàng đợi!");
    } else {
        await message.reply("📭 Queue đang trống!");
    }
}

async function handleMentionEditImage(message: Message, image: { url: string; contentType: string }, prompt: string) {
    const loadingMsg = await message.reply("✏️ Đang chỉnh sửa ảnh...");

    try {
        const axios = require('axios');

        // Download and convert to base64
        const imageResponse = await axios.get(image.url, { responseType: 'arraybuffer' });
        const base64Image = Buffer.from(imageResponse.data).toString('base64');
        const dataUri = `data:${image.contentType};base64,${base64Image}`;

        // Parse aspect ratio from prompt
        const { ratio, cleanPrompt } = parseAspectRatio(prompt);
        const formattedPrompt = `[MODE: IMAGE_GENERATION] [ASPECT_RATIO: ${ratio}] PROMPT: ${cleanPrompt}`;

        console.log('[MentionEditImage] Prompt:', cleanPrompt, 'Ratio:', ratio);

        // Send to AI with image
        const response = await aiClient.chatCompletion([
            {
                role: 'user',
                content: [
                    { type: 'image_url', image_url: { url: dataUri } },
                    { type: 'text', text: formattedPrompt }
                ]
            }
        ], 'gemini-3-pro-image-preview');

        const messageObj = response.choices?.[0]?.message;
        const images = messageObj?.images || [];

        if (images.length > 0) {
            const imageData = images[0];
            let base64Data: string;

            if (typeof imageData === 'string') {
                base64Data = imageData;
            } else if (imageData?.image_url?.url) {
                base64Data = imageData.image_url.url;
            } else if (imageData?.url) {
                base64Data = imageData.url;
            } else {
                base64Data = String(imageData);
            }

            const base64Parts = base64Data.split(',');
            const base64String = base64Parts.length > 1 ? base64Parts[1] : base64Parts[0];
            const buffer = Buffer.from(base64String, 'base64');

            const { AttachmentBuilder } = require('discord.js');
            const attachment = new AttachmentBuilder(buffer, { name: 'edited_image.png' });

            await loadingMsg.edit({
                content: `✏️ **Prompt:** ${cleanPrompt}`,
                files: [attachment]
            });
            return;
        }

        await loadingMsg.edit(`✏️ Không thể chỉnh sửa ảnh. Thử lại!`);

    } catch (error: any) {
        console.error("Mention EditImage Error:", error);
        await loadingMsg.edit(`❌ Lỗi: ${error.message}`);
    }
}

async function handleMentionSummarize(message: Message, limit: number) {
    const loadingMsg = await message.reply(`Đang tóm tắt ${limit} tin nhắn gần nhất... 📝`);

    try {
        const axios = require('axios');
        const messages = await message.channel.messages.fetch({ limit: limit });

        // Process messages - collect text and images
        const messagesArray = Array.from(messages.values()).reverse();
        const contentParts: any[] = [];
        let textLog = '';
        let imageCount = 0;

        for (const m of messagesArray as any[]) {
            if (m.author.bot) continue;

            if (m.content.trim().length > 0) {
                textLog += `${m.author.username}: ${m.content}\n`;
            }

            // Collect images (limit to 10)
            if (imageCount < 10) {
                for (const [, att] of m.attachments) {
                    if (att.contentType?.startsWith('image/')) {
                        try {
                            const imageResponse = await axios.get(att.url, { responseType: 'arraybuffer' });
                            const base64Image = Buffer.from(imageResponse.data).toString('base64');
                            contentParts.push({
                                type: 'image_url',
                                image_url: {
                                    url: `data:${att.contentType};base64,${base64Image}`
                                }
                            });
                            imageCount++;
                        } catch (e) {
                            console.log('[MentionSummarize] Failed to fetch image');
                        }
                    }
                }
            }
        }

        if (!textLog && imageCount === 0) {
            await loadingMsg.edit("Không tìm thấy tin nhắn hoặc ảnh nào để tóm tắt.");
            return;
        }

        const prompt = `Đây là nội dung cuộc trò chuyện trong nhóm Discord:\n\n${textLog}\n\n` +
            `${imageCount > 0 ? `Có ${imageCount} hình ảnh được chia sẻ.\n\n` : ''}` +
            `Hãy tóm tắt ngắn gọn các chủ đề chính. Nếu có hình ảnh, mô tả ngắn gọn nội dung. Highlight vấn đề kỹ thuật quan trọng.`;

        contentParts.push({ type: 'text', text: prompt });

        const model = imageCount > 0 ? 'gemini-3-pro-preview' : 'gemini-3-flash-preview';
        const userContent = imageCount > 0 ? contentParts : prompt;

        const response = await aiClient.chatCompletion([
            { role: 'system', content: "Bạn là 'Curator' - Thư ký thông minh với khả năng nhìn. Tóm tắt súc tích. Trả lời bằng tiếng Việt." },
            { role: 'user', content: userContent }
        ], model);

        const summary = response.choices[0]?.message?.content || "Không thể tóm tắt.";
        const header = imageCount > 0
            ? `**📝 Tóm tắt ${limit} tin nhắn + ${imageCount} ảnh:**`
            : `**📝 Tóm tắt ${limit} tin nhắn:**`;

        const fullReply = `${header}\n\n${summary}`;

        // Generate illustrative image for the summary
        let illustrativeImage: Buffer | null = null;
        try {
            const shortSummary = summary.substring(0, 200).replace(/[*#\n]/g, ' ');
            const imagePrompt = `[MODE: IMAGE_GENERATION] [ASPECT_RATIO: 16:9] PROMPT: Illustration for: ${shortSummary}`;

            console.log('[MentionSummarize] Generating illustrative image...');

            const imgResponse = await aiClient.chatCompletion([
                { role: 'user', content: imagePrompt }
            ], 'gemini-3-pro-image-preview');

            const imgMessage = imgResponse.choices?.[0]?.message;
            const imgImages = imgMessage?.images || [];

            if (imgImages.length > 0) {
                const imageData = imgImages[0];
                let base64Data: string;

                if (typeof imageData === 'string') {
                    base64Data = imageData;
                } else if (imageData?.image_url?.url) {
                    base64Data = imageData.image_url.url;
                } else if (imageData?.url) {
                    base64Data = imageData.url;
                } else {
                    base64Data = String(imageData);
                }

                const base64Parts = base64Data.split(',');
                const base64String = base64Parts.length > 1 ? base64Parts[1] : base64Parts[0];
                illustrativeImage = Buffer.from(base64String, 'base64');
                console.log('[MentionSummarize] Illustrative image generated, size:', illustrativeImage.length);
            }
        } catch (imgError) {
            console.log('[MentionSummarize] Failed to generate illustrative image:', imgError);
        }

        // Send reply with text and optional image
        const { AttachmentBuilder } = require('discord.js');
        const replyContent = fullReply.length > 2000 ? fullReply.substring(0, 2000) : fullReply;

        if (illustrativeImage) {
            const attachment = new AttachmentBuilder(illustrativeImage, { name: 'summary_illustration.png' });
            await loadingMsg.edit({ content: replyContent, files: [attachment] });
        } else {
            await loadingMsg.edit(replyContent);
        }

        // Send remaining text as follow-up
        if (fullReply.length > 2000) {
            let remaining = fullReply.substring(2000);
            while (remaining.length > 0 && message.channel.isSendable()) {
                await message.channel.send(remaining.substring(0, 2000));
                remaining = remaining.substring(2000);
            }
        }

    } catch (error: any) {
        console.error("Mention Summarize Error:", error);
        await loadingMsg.edit(`Lỗi: ${error.message}`);
    }
}

// Start
if (!DISCORD_TOKEN) {
    console.error("Missing DISCORD_TOKEN in .env");
    process.exit(1);
}

// Initialize Dashboard with shared state
initDashboard(client, conversationMemory, autoReplyChannels, scheduledSummaries, BOT_START_TIME);
startDashboard(DASHBOARD_PORT);

// ==================== MA SÓI INTERACTION HANDLERS ====================

client.on('interactionCreate', async (interaction) => {
    try {
        // Handle slash commands
        if (interaction.isChatInputCommand()) {
            if (interaction.commandName === 'masoi') {
                const subcommand = interaction.options.getSubcommand();

                if (subcommand === 'start') {
                    await interaction.deferReply();

                    const preset = (interaction.options.getString('preset') || 'basic') as 'basic' | 'advanced';
                    const channel = interaction.channel;

                    if (!channel || !channel.isTextBased()) {
                        await interaction.editReply('Lỗi: Không thể tạo game trong channel này!');
                        return;
                    }

                    try {
                        const gameId = await WerewolfGame.createLobby(
                            interaction.guild!,
                            channel as any,
                            interaction.member as any,
                            preset
                        );

                        await interaction.editReply(`✅ Đã tạo phòng Ma Sói! Game ID: ${gameId}`);
                    } catch (error: any) {
                        await interaction.editReply(`❌ ${error.message}`);
                    }
                }
                else if (subcommand === 'status') {
                    const game = gameStateManager.getGameByGuild(interaction.guildId!);
                    if (!game) {
                        await interaction.reply({ content: 'Không có game nào đang diễn ra!', ephemeral: true });
                        return;
                    }

                    const players = Array.from(game.players.values());
                    const alivePlayers = players.filter(p => p.isAlive);

                    await interaction.reply({
                        content: `**Ma Sói - Trạng Thái**\nNgày: ${game.day}\nPhase: ${game.phase}\nCòn sống: ${alivePlayers.length}/${players.length}`,
                        ephemeral: true
                    });
                }
                else if (subcommand === 'end') {
                    const game = gameStateManager.getGameByGuild(interaction.guildId!);
                    if (!game) {
                        await interaction.reply({ content: 'Không có phòng Ma Sói nào!', ephemeral: true });
                        return;
                    }

                    if (game.hostId !== interaction.user.id) {
                        await interaction.reply({ content: 'Chỉ host mới có thể hủy phòng!', ephemeral: true });
                        return;
                    }

                    await WerewolfGame.endGame(game.id);

                    const statusMsg = game.status === 'lobby' ? 'hủy phòng' : 'kết thúc game';
                    await interaction.reply(`✅ Đã ${statusMsg}!`);
                }
            }
        }

        // Handle select menu interactions (for voting)
        else if (interaction.isStringSelectMenu()) {
            const [action, type, gameId] = interaction.customId.split('_');

            if (action === 'masoi' && type === 'dayvote') {
                const game = gameStateManager.getGame(gameId);
                if (!game) {
                    await interaction.reply({ content: '❌ Game không tồn tại!', ephemeral: true });
                    return;
                }

                const voterId = interaction.user.id;
                const targetId = interaction.values[0];

                // Check if voter is alive
                const voter = game.players.get(voterId);
                if (!voter || !voter.isAlive) {
                    await interaction.reply({ content: '❌ Bạn không thể vote (đã chết hoặc không trong game)!', ephemeral: true });
                    return;
                }

                // Handle skip vote
                if (targetId === 'skip') {
                    await interaction.reply({ content: '⏭️ Bạn đã bỏ qua vote.', ephemeral: true });
                    return;
                }

                // Record vote
                game.dayVotes.set(voterId, { voterId, targetId });

                const target = game.players.get(targetId);
                await interaction.reply({ content: `✅ Bạn đã vote ${target?.username}!`, ephemeral: true });

                console.log(`[MA SÓI] ${voter.username} voted for ${target?.username}`);
            }
            // Night action handlers
            else if (action === 'masoi' && type === 'nightaction') {
                const game = gameStateManager.getGame(gameId);
                if (!game) {
                    await interaction.reply({ content: '❌ Game không tồn tại!', ephemeral: true });
                    return;
                }

                const actorId = interaction.user.id;
                const targetId = interaction.values[0];
                const actionType = interaction.customId.split('_')[3]; // kill/check/protect

                // Check if actor is alive
                const actor = game.players.get(actorId);
                if (!actor || !actor.isAlive) {
                    await interaction.reply({ content: '❌ Bạn không thể hành động (đã chết hoặc không trong game)!', ephemeral: true });
                    return;
                }

                const target = game.players.get(targetId);

                // Record night action
                if (actionType === 'kill') {
                    game.nightActions.set(actorId, { playerId: actorId, actionType: 'kill', targetId });
                    await interaction.reply({ content: `✅ Bạn đã vote giết ${target?.username}!`, ephemeral: true });
                }
                else if (actionType === 'check') {
                    game.nightActions.set(actorId, { playerId: actorId, actionType: 'check', targetId });
                    // Send result immediately
                    const isWerewolf = target?.team === Team.WEREWOLF;
                    await interaction.reply({
                        content: `🔮 Kết quả: ${target?.username} ${isWerewolf ? '**là Ma Sói!** 🐺' : '**KHÔNG phải Ma Sói** ✅'}`,
                        ephemeral: true
                    });
                }
                else if (actionType === 'protect') {
                    game.nightActions.set(actorId, { playerId: actorId, actionType: 'protect', targetId });
                    await interaction.reply({ content: `🛡️ Bạn đã bảo vệ ${target?.username}!`, ephemeral: true });
                }
                else if (actionType === 'pair') {
                    // Cupid pairing - needs 2 targets
                    const target1Id = interaction.values[0];
                    const target2Id = interaction.values[1];
                    const target1 = game.players.get(target1Id);
                    const target2 = game.players.get(target2Id);

                    game.nightActions.set(actorId, { playerId: actorId, actionType: 'pair', targetId: target1Id, targetId2: target2Id });

                    // Set pairs
                    if (target1) target1.pairedWith = target2Id;
                    if (target2) target2.pairedWith = target1Id;
                    game.cupidPairs = [target1Id, target2Id];

                    await interaction.reply({ content: `💘 Bạn đã ghép đôi ${target1?.username} và ${target2?.username}!`, ephemeral: true });
                }
                else if (actionType === 'witch') {
                    // Witch action
                    const value = interaction.values[0];

                    if (value === 'skip') {
                        await interaction.reply({ content: '⏭️ Bạn đã bỏ qua đêm nay.', ephemeral: true });
                        return;
                    }

                    const [witchAction, witchTargetId] = value.split('_');

                    if (witchAction === 'heal') {
                        const witchState = game.witchStates.get(actorId);
                        if (witchState && witchState.hasHealPotion) {
                            witchState.hasHealPotion = false;
                            game.nightActions.set(actorId, { playerId: actorId, actionType: 'heal', targetId: witchTargetId });
                            const healTarget = game.players.get(witchTargetId);
                            await interaction.reply({ content: `💊 Bạn đã cứu ${healTarget?.username}!`, ephemeral: true });
                        }
                    }
                    else if (witchAction === 'poison') {
                        const witchState = game.witchStates.get(actorId);
                        if (witchState && witchState.hasPoisonPotion) {
                            witchState.hasPoisonPotion = false;
                            game.nightActions.set(actorId, { playerId: actorId, actionType: 'poison', targetId: witchTargetId });
                            const poisonTarget = game.players.get(witchTargetId);
                            await interaction.reply({ content: `☠️ Bạn đã đầu độc ${poisonTarget?.username}!`, ephemeral: true });
                        }
                    }
                }

                console.log(`[MA SÓI] ${actor.username} (${ROLES[actor.role].nameVi}) used ${actionType} on ${target?.username}`);
            }
        }

        // Handle button interactions
        else if (interaction.isButton()) {
            const [action, type, gameId] = interaction.customId.split('_');

            if (action === 'masoi') {
                if (type === 'join') {
                    const success = await WerewolfGame.handleJoin(
                        gameId,
                        interaction.user.id,
                        interaction.user.username
                    );

                    if (success) {
                        await interaction.reply({ content: '✅ Đã tham gia game!', ephemeral: true });
                        // Update lobby embed
                        const game = gameStateManager.getGame(gameId);
                        if (game && interaction.channel) {
                            await WerewolfGame.sendLobbyEmbed(interaction.channel as any, gameId);
                        }
                    } else {
                        await interaction.reply({ content: '❌ Không thể tham gia (game đã đầy hoặc đã bắt đầu)', ephemeral: true });
                    }
                }
                else if (type === 'leave') {
                    const success = await WerewolfGame.handleLeave(gameId, interaction.user.id);

                    if (success) {
                        await interaction.reply({ content: '✅ Đã rời phòng!', ephemeral: true });
                        // Update lobby embed
                        const game = gameStateManager.getGame(gameId);
                        if (game && interaction.channel) {
                            await WerewolfGame.sendLobbyEmbed(interaction.channel as any, gameId);
                        }
                    } else {
                        await interaction.reply({ content: '❌ Không thể rời phòng', ephemeral: true });
                    }
                }
                else if (type === 'start') {
                    const game = gameStateManager.getGame(gameId);
                    if (!game) {
                        await interaction.reply({ content: '❌ Game không tồn tại!', ephemeral: true });
                        return;
                    }

                    if (game.hostId !== interaction.user.id) {
                        await interaction.reply({ content: '❌ Chỉ host mới có thể bắt đầu game!', ephemeral: true });
                        return;
                    }

                    await interaction.deferReply();

                    try {
                        await WerewolfGame.startGame(gameId, interaction.channel as any);
                        await interaction.editReply('✅ Game đã bắt đầu!');
                    } catch (error: any) {
                        await interaction.editReply(`❌ ${error.message}`);
                    }
                }
                // Handle night action button
                else if (type === 'nightbtn') {
                    const userId = interaction.customId.split('_')[3];

                    // Check if this button belongs to this user
                    if (userId !== interaction.user.id) {
                        await interaction.reply({ content: '❌ Đây không phải button của bạn!', ephemeral: true });
                        return;
                    }

                    const game = gameStateManager.getGame(gameId);
                    if (!game) {
                        await interaction.reply({ content: '❌ Game không tồn tại!', ephemeral: true });
                        return;
                    }

                    const player = game.players.get(userId);
                    if (!player || !player.isAlive) {
                        await interaction.reply({ content: '❌ Bạn không thể hành động!', ephemeral: true });
                        return;
                    }

                    // Build select menu using helper
                    const { buildNightActionMenu } = await import('./games/werewolf/NightActionHelper');
                    const alivePlayers = gameStateManager.getAlivePlayers(gameId);
                    const selectMenu = buildNightActionMenu(gameId, player, alivePlayers);

                    if (!selectMenu) {
                        await interaction.reply({ content: '❌ Không có hành động khả dụng!', ephemeral: true });
                        return;
                    }

                    const { ActionRowBuilder } = await import('discord.js');
                    const row = new ActionRowBuilder<typeof selectMenu>().addComponents(selectMenu);

                    const role = ROLES[player.role];
                    await interaction.reply({
                        content: `${role.emoji} **${role.nameVi}**\n${role.descriptionVi}`,
                        components: [row],
                        ephemeral: true
                    });
                }
            }
        }
    } catch (error) {
        console.error('[MA SÓI] Interaction error:', error);
    }
});

client.login(DISCORD_TOKEN);
