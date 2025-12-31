/**
 * Game state management for Werewolf game
 */

import { RoleType, Team } from './Roles';

export enum GameStatus {
    LOBBY = 'lobby',
    NIGHT = 'night',
    DAY = 'day',
    ENDED = 'ended'
}

export enum GamePhase {
    NIGHT = 'night',
    DAY = 'day'
}

export interface Player {
    userId: string;
    username: string;
    role: RoleType;
    team: Team;
    isAlive: boolean;
    isProtected: boolean; // Guard protection
    pairedWith?: string; // Cupid pair
    lastProtectedBy?: string; // For guard cannot protect same player twice
}

export interface NightAction {
    playerId: string;
    actionType: 'kill' | 'check' | 'protect' | 'heal' | 'poison' | 'pair';
    targetId?: string;
    targetId2?: string; // For cupid pairing
}

export interface DayVote {
    voterId: string;
    targetId: string;
}

export interface GameEvent {
    type: string;
    timestamp: Date;
    description: string;
    data?: any;
}

export interface WitchState {
    hasHealPotion: boolean;
    hasPoisonPotion: boolean;
}

export interface GameConfig {
    preset: 'mini' | 'basic' | 'advanced';
    minPlayers: number;
    maxPlayers: number;
    nightDuration: number; // seconds
    dayDuration: number; // seconds
}

export interface WerewolfGameState {
    id: string;
    guildId: string;
    channelId: string;
    hostId: string;
    status: GameStatus;
    players: Map<string, Player>;
    config: GameConfig;
    day: number;
    phase: GamePhase;

    // Voting and actions
    dayVotes: Map<string, DayVote>;
    nightActions: Map<string, NightAction>;

    // Role-specific state
    witchStates: Map<string, WitchState>;
    lastProtectedPlayer?: string; // For guard rule
    cupidPairs?: [string, string]; // Cupid paired players

    // Channels
    werewolfChannelId?: string; // Private werewolf chat
    roleChannels: Map<string, string>; // Role-specific channels

    // History
    history: GameEvent[];

    // Timer
    phaseEndTime?: Date;

    createdAt: Date;
}

export class GameStateManager {
    private games: Map<string, WerewolfGameState> = new Map();

    createGame(
        guildId: string,
        channelId: string,
        hostId: string,
        config: GameConfig
    ): WerewolfGameState {
        const gameId = `${guildId}-${Date.now()}`;

        const gameState: WerewolfGameState = {
            id: gameId,
            guildId,
            channelId,
            hostId,
            status: GameStatus.LOBBY,
            players: new Map(),
            config,
            day: 0,
            phase: GamePhase.NIGHT,
            dayVotes: new Map(),
            nightActions: new Map(),
            witchStates: new Map(),
            roleChannels: new Map(),
            history: [],
            createdAt: new Date()
        };

        this.games.set(gameId, gameState);
        return gameState;
    }

    getGame(gameId: string): WerewolfGameState | undefined {
        return this.games.get(gameId);
    }

    getGameByGuild(guildId: string): WerewolfGameState | undefined {
        return Array.from(this.games.values()).find(
            game => game.guildId === guildId && game.status !== GameStatus.ENDED
        );
    }

    deleteGame(gameId: string): void {
        this.games.delete(gameId);
    }

    addPlayer(gameId: string, userId: string, username: string): boolean {
        const game = this.games.get(gameId);
        if (!game || game.status !== GameStatus.LOBBY) {
            return false;
        }

        if (game.players.has(userId)) {
            return false; // Already joined
        }

        if (game.players.size >= game.config.maxPlayers) {
            return false; // Game full
        }

        // Player will get role assigned when game starts
        game.players.set(userId, {
            userId,
            username,
            role: RoleType.VILLAGER, // Placeholder
            team: Team.VILLAGE, // Placeholder
            isAlive: true,
            isProtected: false
        });

        this.addEvent(gameId, {
            type: 'player_join',
            timestamp: new Date(),
            description: `${username} joined the game`,
            data: { userId }
        });

        return true;
    }

    removePlayer(gameId: string, userId: string): boolean {
        const game = this.games.get(gameId);
        if (!game || game.status !== GameStatus.LOBBY) {
            return false;
        }

        const player = game.players.get(userId);
        if (!player) {
            return false;
        }

        game.players.delete(userId);

        this.addEvent(gameId, {
            type: 'player_leave',
            timestamp: new Date(),
            description: `${player.username} left the game`,
            data: { userId }
        });

        return true;
    }

    addEvent(gameId: string, event: GameEvent): void {
        const game = this.games.get(gameId);
        if (game) {
            game.history.push(event);
        }
    }

    getAlivePlayers(gameId: string): Player[] {
        const game = this.games.get(gameId);
        if (!game) return [];

        return Array.from(game.players.values()).filter(p => p.isAlive);
    }

    getAlivePlayersByTeam(gameId: string, team: Team): Player[] {
        return this.getAlivePlayers(gameId).filter(p => p.team === team);
    }

    getPlayersByRole(gameId: string, role: RoleType): Player[] {
        const game = this.games.get(gameId);
        if (!game) return [];

        return Array.from(game.players.values()).filter(p => p.role === role && p.isAlive);
    }
}

// Singleton instance
export const gameStateManager = new GameStateManager();
