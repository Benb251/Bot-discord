/**
 * Role definitions for Werewolf game
 */

export enum RoleType {
    // Tier 1 - Basic roles
    WEREWOLF = 'werewolf',
    VILLAGER = 'villager',
    SEER = 'seer',
    GUARD = 'guard',

    // Tier 2 - Advanced roles
    HUNTER = 'hunter',
    CUPID = 'cupid',
    WITCH = 'witch',
    LITTLE_GIRL = 'little_girl'
}

export enum Team {
    WEREWOLF = 'werewolf',
    VILLAGE = 'village'
}

export interface Role {
    type: RoleType;
    team: Team;
    name: string;
    nameVi: string;
    emoji: string;
    description: string;
    descriptionVi: string;
    canActAtNight: boolean;
    tier: 1 | 2;
}

export const ROLES: Record<RoleType, Role> = {
    [RoleType.WEREWOLF]: {
        type: RoleType.WEREWOLF,
        team: Team.WEREWOLF,
        name: 'Werewolf',
        nameVi: 'Ma Sói',
        emoji: '🐺',
        description: 'Vote to kill one villager each night',
        descriptionVi: 'Mỗi đêm vote giết 1 người',
        canActAtNight: true,
        tier: 1
    },
    [RoleType.VILLAGER]: {
        type: RoleType.VILLAGER,
        team: Team.VILLAGE,
        name: 'Villager',
        nameVi: 'Dân Làng',
        emoji: '👤',
        description: 'No special abilities, vote during day',
        descriptionVi: 'Không có kỹ năng, vote vào ban ngày',
        canActAtNight: false,
        tier: 1
    },
    [RoleType.SEER]: {
        type: RoleType.SEER,
        team: Team.VILLAGE,
        name: 'Seer',
        nameVi: 'Tiên Tri',
        emoji: '🔮',
        description: 'Check one player each night to know their team',
        descriptionVi: 'Mỗi đêm kiểm tra 1 người xem là Ma Sói hay không',
        canActAtNight: true,
        tier: 1
    },
    [RoleType.GUARD]: {
        type: RoleType.GUARD,
        team: Team.VILLAGE,
        name: 'Guard',
        nameVi: 'Bảo Vệ',
        emoji: '🛡️',
        description: 'Protect one player each night (cannot protect same player twice in a row)',
        descriptionVi: 'Bảo vệ 1 người mỗi đêm (không được bảo vệ cùng người 2 đêm liên tiếp)',
        canActAtNight: true,
        tier: 1
    },
    [RoleType.HUNTER]: {
        type: RoleType.HUNTER,
        team: Team.VILLAGE,
        name: 'Hunter',
        nameVi: 'Thợ Săn',
        emoji: '🎯',
        description: 'When dies, shoots one player',
        descriptionVi: 'Khi chết, bắn 1 người',
        canActAtNight: false,
        tier: 2
    },
    [RoleType.CUPID]: {
        type: RoleType.CUPID,
        team: Team.VILLAGE,
        name: 'Cupid',
        nameVi: 'Thần Tình Yêu',
        emoji: '💘',
        description: 'Pairs two players at game start (they die together)',
        descriptionVi: 'Ghép đôi 2 người lúc đầu game (chết cùng nhau)',
        canActAtNight: true, // Only night 0
        tier: 2
    },
    [RoleType.WITCH]: {
        type: RoleType.WITCH,
        team: Team.VILLAGE,
        name: 'Witch',
        nameVi: 'Phù Thủy',
        emoji: '🎭',
        description: 'Has 1 heal potion and 1 poison (use once each)',
        descriptionVi: 'Có 1 thuốc cứu và 1 thuốc độc (dùng 1 lần mỗi loại)',
        canActAtNight: true,
        tier: 2
    },
    [RoleType.LITTLE_GIRL]: {
        type: RoleType.LITTLE_GIRL,
        team: Team.VILLAGE,
        name: 'Little Girl',
        nameVi: 'Bé Gái',
        emoji: '👧',
        description: 'Can peek at werewolf chat at night',
        descriptionVi: 'Có thể nhìn trộm chat Ma Sói ban đêm',
        canActAtNight: true,
        tier: 2
    }
};

/**
 * Preset configurations for different player counts
 */
export interface RolePreset {
    minPlayers: number;
    maxPlayers: number;
    roles: RoleType[];
}

export const ROLE_PRESETS: Record<string, RolePreset> = {
    mini: {
        minPlayers: 6,
        maxPlayers: 8,
        roles: [
            RoleType.WEREWOLF,        // 1 Ma Sói
            RoleType.SEER,            // 1 Tiên Tri
            RoleType.GUARD,           // 1 Bảo Vệ
            RoleType.VILLAGER,        // 3 Dân Làng
            RoleType.VILLAGER,
            RoleType.VILLAGER
        ]
    },
    basic: {
        minPlayers: 8,
        maxPlayers: 10,
        roles: [
            RoleType.WEREWOLF,
            RoleType.WEREWOLF,
            RoleType.SEER,
            RoleType.GUARD,
            RoleType.VILLAGER,
            RoleType.VILLAGER,
            RoleType.VILLAGER,
            RoleType.VILLAGER
        ]
    },
    advanced: {
        minPlayers: 10,
        maxPlayers: 15,
        roles: [
            RoleType.WEREWOLF,
            RoleType.WEREWOLF,
            RoleType.WEREWOLF,
            RoleType.SEER,
            RoleType.GUARD,
            RoleType.HUNTER,
            RoleType.CUPID,
            RoleType.WITCH,
            RoleType.VILLAGER,
            RoleType.VILLAGER
        ]
    }
};

/**
 * Distribute roles to players based on player count
 */
export function distributeRoles(playerCount: number, preset: string = 'basic'): RoleType[] {
    const presetConfig = ROLE_PRESETS[preset];
    if (!presetConfig) {
        throw new Error(`Unknown preset: ${preset}`);
    }

    if (playerCount < presetConfig.minPlayers || playerCount > presetConfig.maxPlayers) {
        throw new Error(`Player count ${playerCount} not in range [${presetConfig.minPlayers}, ${presetConfig.maxPlayers}]`);
    }

    const roles = [...presetConfig.roles];

    // Fill remaining slots with villagers
    while (roles.length < playerCount) {
        roles.push(RoleType.VILLAGER);
    }

    // Shuffle roles
    for (let i = roles.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [roles[i], roles[j]] = [roles[j], roles[i]];
    }

    return roles.slice(0, playerCount);
}
