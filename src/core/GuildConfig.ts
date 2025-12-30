// Multi-Guild Configuration Store
// Stores per-guild settings that persist in memory

export interface GuildConfig {
    guildId: string;
    prefix?: string;
    language?: string;
    autoReplyChannels: Set<string>;
    disabledCommands: Set<string>;
    customPersonas: Map<string, string>;
    maxMemoryMessages?: number;
    memoryExpiryMinutes?: number;
}

const guildConfigs = new Map<string, GuildConfig>();

export function getGuildConfig(guildId: string): GuildConfig {
    if (!guildConfigs.has(guildId)) {
        guildConfigs.set(guildId, {
            guildId,
            autoReplyChannels: new Set(),
            disabledCommands: new Set(),
            customPersonas: new Map(),
            maxMemoryMessages: 20,
            memoryExpiryMinutes: 30
        });
    }
    return guildConfigs.get(guildId)!;
}

export function setGuildConfig(guildId: string, updates: Partial<GuildConfig>): GuildConfig {
    const config = getGuildConfig(guildId);
    Object.assign(config, updates);
    return config;
}

export function isCommandDisabled(guildId: string, commandName: string): boolean {
    const config = getGuildConfig(guildId);
    return config.disabledCommands.has(commandName);
}

export function setAutoReply(guildId: string, channelId: string, enabled: boolean) {
    const config = getGuildConfig(guildId);
    if (enabled) {
        config.autoReplyChannels.add(channelId);
    } else {
        config.autoReplyChannels.delete(channelId);
    }
}

export function isAutoReplyChannel(guildId: string, channelId: string): boolean {
    const config = getGuildConfig(guildId);
    return config.autoReplyChannels.has(channelId);
}

export function getAllGuildConfigs(): Map<string, GuildConfig> {
    return guildConfigs;
}

export function setCustomPersona(guildId: string, name: string, prompt: string) {
    const config = getGuildConfig(guildId);
    config.customPersonas.set(name, prompt);
}

export function getCustomPersona(guildId: string, name: string): string | undefined {
    const config = getGuildConfig(guildId);
    return config.customPersonas.get(name);
}
