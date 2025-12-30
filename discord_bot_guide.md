# Hướng Dẫn Kết Nối Discord Bot với ProxyPal

ProxyPal cung cấp một API **tương thích hoàn toàn với chuẩn OpenAI**. Điều này có nghĩa là bạn có thể sử dụng bất kỳ thư viện nào hỗ trợ OpenAI (như `openai` npm package hoặc `openai` python package) để kết nối, chỉ cần thay đổi **Base URL**.

## Thông Tin Kết Nối Cơ Bản

*   **Base URL:** `http://localhost:8317/v1`
*   **API Key:** `proxypal-local`
*   **Model ID (Ví dụ):** `gemini-3-pro-preview`, `gemini-3-pro-image-preview`

---

## Cách 1: Sử dụng thư viện `openai` (Khuyên dùng)

Cách này tách biệt logic gọi AI và logic Discord, giúp code gọn gàng.

### Cấu hình Client (Node.js / JavaScript)

```javascript
import OpenAI from 'openai';

const openai = new OpenAI({
  baseURL: 'http://localhost:8317/v1', // Trỏ về ProxyPal local
  apiKey: 'proxypal-local',            // Key mặc định của ProxyPal
});

async function askAI(prompt) {
  const completion = await openai.chat.completions.create({
    messages: [{ role: 'user', content: prompt }],
    model: 'gemini-3-pro-preview', // Chọn model bạn muốn
  });

  return completion.choices[0].message.content;
}
```

### Cấu hình Client (Python)

```python
from openai import OpenAI

client = OpenAI(
    base_url="http://localhost:8317/v1",
    api_key="proxypal-local"
)

response = client.chat.completions.create(
    model="gemini-3-pro-preview",
    messages=[{"role": "user", "content": "Xin chào!"}]
)

print(response.choices[0].message.content)
```

---

## Cách 2: Tích hợp vào Discord Bot (Ví dụ Node.js + discord.js)

Dưới đây là ví dụ một bot Discord đơn giản: nhận tin nhắn và trả lời bằng ProxyPal.

**Cài đặt:**
```bash
npm install discord.js openai dotenv
```

**Code (`bot.js`):**

```javascript
require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js');
const OpenAI = require('openai');

// 1. Cấu hình AI Client kết nối tới ProxyPal
const aiClient = new OpenAI({
    baseURL: 'http://localhost:8317/v1',
    apiKey: 'proxypal-local'
});

// 2. Cấu hình Discord Bot
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

client.on('ready', () => {
    console.log(`Bot đã online: ${client.user.tag}`);
});

client.on('messageCreate', async (message) => {
    // Bỏ qua tin nhắn của chính bot
    if (message.author.bot) return;

    try {
        // Gửi trạng thái "Typing..."
        await message.channel.sendTyping();

        // Gọi ProxyPal API
        const response = await aiClient.chat.completions.create({
            model: 'gemini-3-pro-preview',
            messages: [
                { role: "system", content: "Bạn là một trợ lý Discord hữu ích." },
                { role: "user", content: message.content }
            ]
        });

        // Trả lời về Discord
        const aiReply = response.choices[0].message.content;
        await message.reply(aiReply);

    } catch (error) {
        console.error("Lỗi gọi AI:", error);
        await message.reply("Xin lỗi, ProxyPal đang gặp sự cố kết nối!");
    }
});

// Thay thế bằng Token Bot Discord thật của bạn
client.login('YOUR_DISCORD_BOT_TOKEN');
```

## Lưu ý Quan trọng

1.  **ProxyPal Phải Đang Chạy:** Bot của bạn kết nối tới `localhost:8317`, nên ứng dụng ProxyPal (cửa sổ Windows) phải đang mở và ở trạng thái "Running".
2.  **Hosting:** Nếu bạn deploy bot lên VPS hoặc Hosting (không phải máy tính cá nhân), bạn sẽ không thể kết nối tới `localhost`. Khi đó bạn cần dùng `ngrok` hoặc thiết lập IP Public để trỏ về máy tính chạy ProxyPal (nhưng việc này phức tạp và kém bảo mật hơn). **Giải pháp tốt nhất là chạy Bot ngay trên máy tính đang bật ProxyPal.**
