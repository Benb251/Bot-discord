import { REST, Routes } from 'discord.js';
import * as dotenv from 'dotenv';

dotenv.config();

const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
if (!DISCORD_TOKEN) {
    console.error("Missing DISCORD_TOKEN");
    process.exit(1);
}

// Auto-detect Client ID from token
const parts = DISCORD_TOKEN.split('.');
const clientId = Buffer.from(parts[0], 'base64').toString('ascii');

console.log(`Clearing global commands for client: ${clientId}...`);

const rest = new REST({ version: '10' }).setToken(DISCORD_TOKEN);

rest.put(Routes.applicationCommands(clientId), { body: [] })
    .then(() => console.log('✅ Global commands cleared! Only guild commands remain.'))
    .catch(console.error);
