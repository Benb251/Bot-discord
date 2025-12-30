import axios from 'axios';
import * as fs from 'fs';

interface Account {
    id: string;
    apiKey: string;
    status: 'ACTIVE' | 'RATE_LIMITED' | 'COOLDOWN' | 'DEAD';
    lastUsed: number;
    failureCount: number;
}

export class AntigravityPool {
    private accounts: Account[] = [];
    private cooldownMap: Map<string, number> = new Map(); // accountId -> timestamp when cooldown ends

    constructor(tokenFile: string) {
        this.loadAccounts(tokenFile);
    }

    private loadAccounts(tokenFile: string) {
        try {
            if (fs.existsSync(tokenFile)) {
                const tokens = fs.readFileSync(tokenFile, 'utf-8').split('\n').filter(line => line.trim().length > 0);
                this.accounts = tokens.map((token, index) => ({
                    id: `acc_${index + 1}`,
                    apiKey: token.trim(),
                    status: 'ACTIVE',
                    lastUsed: 0,
                    failureCount: 0
                }));
                console.log(`[AntigravityPool] Loaded ${this.accounts.length} accounts.`);
            } else {
                console.warn(`[AntigravityPool] Token file not found: ${tokenFile}`);
            }
        } catch (error) {
            console.error(`[AntigravityPool] Error loading tokens:`, error);
        }
    }

    public getBestAccount(): Account | null {
        const now = Date.now();

        // Check cooldowns
        this.accounts.forEach(acc => {
            if (acc.status === 'COOLDOWN') {
                const cooldownEnd = this.cooldownMap.get(acc.id) || 0;
                if (now > cooldownEnd) {
                    acc.status = 'ACTIVE';
                    acc.failureCount = 0; // reset failures on success recover
                    console.log(`[AntigravityPool] Account ${acc.id} recovered from cooldown.`);
                }
            }
        });

        // Filter active accounts
        const activeAccounts = this.accounts.filter(acc => acc.status === 'ACTIVE');

        if (activeAccounts.length === 0) {
            console.error("[AntigravityPool] ALL ACCOUNTS ARE BUSY/DEAD!");
            return null;
        }

        // Sort by lastUsed ASC (Use the one that rested the longest)
        activeAccounts.sort((a, b) => a.lastUsed - b.lastUsed);

        const bestAcc = activeAccounts[0];
        bestAcc.lastUsed = now; // Mark as used
        return bestAcc;
    }

    public reportFailure(accountId: string, statusCode: number) {
        const acc = this.accounts.find(a => a.id === accountId);
        if (!acc) return;

        if (statusCode === 429) {
            acc.status = 'COOLDOWN';
            const cooldownTime = 10 * 60 * 1000; // 10 minutes
            this.cooldownMap.set(acc.id, Date.now() + cooldownTime);
            console.warn(`[AntigravityPool] Account ${acc.id} hit 429. Cooldown until ${new Date(Date.now() + cooldownTime).toISOString()}`);
        } else if (statusCode === 401 || statusCode === 403) {
            acc.status = 'DEAD';
            console.error(`[AntigravityPool] Account ${acc.id} is invalid (401/403). Marked as DEAD.`);
        } else {
            acc.failureCount++;
            if (acc.failureCount > 3) {
                acc.status = 'COOLDOWN';
                this.cooldownMap.set(acc.id, Date.now() + 60000); // 1 min soft cooldown
                console.warn(`[AntigravityPool] Account ${acc.id} failed 3 times. Soft cooldown.`);
            }
        }
    }
}
