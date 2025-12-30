import express from 'express';
import cors from 'cors';
import path from 'path';

// Types
interface GuildConfig {
    guildId: string;
    guildName: string;
    autoReplyChannels: string[];
    scheduledSummaries: { channelId: string; time: string; limit: number }[];
    memorySize: number;
}

interface DashboardData {
    uptime: number;
    totalGuilds: number;
    totalMemoryContexts: number;
    totalMessages: number;
    guilds: GuildConfig[];
}

// Shared state (will be populated by main bot)
let botClient: any = null;
let conversationMemory: Map<string, any[]> = new Map();
let autoReplyChannels: Set<string> = new Set();
let scheduledSummaries: Map<string, any> = new Map();
let botStartTime: number = Date.now();

export function initDashboard(
    client: any,
    memory: Map<string, any[]>,
    autoReply: Set<string>,
    schedules: Map<string, any>,
    startTime: number
) {
    botClient = client;
    conversationMemory = memory;
    autoReplyChannels = autoReply;
    scheduledSummaries = schedules;
    botStartTime = startTime;
}

const app = express();
app.use(cors());
app.use(express.json());

// Serve static dashboard (from project root /dashboard folder)
app.use(express.static(path.join(__dirname, '../../dashboard')));

// API Routes
app.get('/api/status', (req, res) => {
    const uptimeMs = Date.now() - botStartTime;
    let totalMessages = 0;
    conversationMemory.forEach(msgs => totalMessages += msgs.length);

    res.json({
        status: 'online',
        uptime: Math.floor(uptimeMs / 1000),
        uptimeFormatted: formatUptime(uptimeMs),
        botTag: botClient?.user?.tag || 'Unknown',
        totalGuilds: botClient?.guilds?.cache?.size || 0,
        totalMemoryContexts: conversationMemory.size,
        totalMessages,
        autoReplyChannels: autoReplyChannels.size,
        scheduledSummaries: scheduledSummaries.size
    });
});

app.get('/api/guilds', (req, res) => {
    if (!botClient) {
        return res.json([]);
    }

    const guilds = botClient.guilds.cache.map((g: any) => ({
        id: g.id,
        name: g.name,
        memberCount: g.memberCount,
        icon: g.iconURL()
    }));

    res.json(guilds);
});

app.get('/api/memory', (req, res) => {
    const memory: any[] = [];
    conversationMemory.forEach((msgs, contextId) => {
        memory.push({
            contextId,
            messageCount: msgs.length,
            lastActivity: msgs.length > 0 ? msgs[msgs.length - 1].timestamp : null
        });
    });
    res.json(memory);
});

app.delete('/api/memory/:contextId', (req, res) => {
    const { contextId } = req.params;
    conversationMemory.delete(contextId);
    res.json({ success: true, message: `Memory cleared for ${contextId}` });
});

app.get('/api/auto-reply', (req, res) => {
    res.json(Array.from(autoReplyChannels));
});

app.post('/api/auto-reply/:channelId', (req, res) => {
    const { channelId } = req.params;
    const { enabled } = req.body;

    if (enabled) {
        autoReplyChannels.add(channelId);
    } else {
        autoReplyChannels.delete(channelId);
    }

    res.json({ success: true, enabled });
});

// Helper
function formatUptime(ms: number): string {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) return `${days}d ${hours % 24}h ${minutes % 60}m`;
    if (hours > 0) return `${hours}h ${minutes % 60}m`;
    return `${minutes}m ${seconds % 60}s`;
}

export function startDashboard(port: number = 3000) {
    app.listen(port, () => {
        console.log(`[Dashboard] Running at http://localhost:${port}`);
    });
}

export default app;
