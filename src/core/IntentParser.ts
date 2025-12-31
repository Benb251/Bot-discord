import { AntigravityClient } from './AntigravityClient';

// Intent types for music commands
export type MusicIntent =
    | { type: 'play'; query: string }
    | { type: 'stop' }
    | { type: 'skip' }
    | { type: 'queue' }
    | { type: 'clear' }
    | { type: 'leave' }
    | { type: 'none' }; // Not a music command

const client = new AntigravityClient();

// System prompt for intent parsing
const INTENT_SYSTEM_PROMPT = `Bạn là một AI phân tích ý định người dùng cho bot Discord phát nhạc.

Phân tích tin nhắn và trả về JSON với format:
{"type": "play|stop|skip|queue|clear|leave|none", "query": "tên bài hát nếu có", "url": "URL nếu có"}

Các ý định:
- "play": Người dùng muốn phát nhạc hoặc thêm bài (ví dụ: "bật nhạc đi", "mở bài MCK", "thêm bài này vào queue")
- "stop": Dừng/tắt nhạc (ví dụ: "tắt đi bé", "stop", "dừng nhạc lại")
- "skip": Bỏ qua bài hiện tại (ví dụ: "skip đi", "bài khác đi", "bỏ qua bài này")
- "queue": Xem danh sách chờ (ví dụ: "xem queue", "còn bao nhiêu bài")
- "clear": Xóa hàng đợi (ví dụ: "xóa queue đi", "clear hết")
- "leave": Bot rời kênh voice (ví dụ: "ra đi bé", "bye", "rời kênh")
- "none": Không phải lệnh nhạc, chỉ là chat thông thường

Lưu ý:
- Hiểu cả tiếng Việt có dấu và không dấu
- Hiểu các cách nói tự nhiên, thân mật như "đi bé", "nha", "luôn đi"
- Nếu có tên bài hát, trích xuất vào "query"
- **QUAN TRỌNG: Nếu có URL (Spotify, YouTube, etc.), trích xuất CHÍNH XÁC vào "url"**
- Ví dụ: "phát list này https://open.spotify.com/..." → {"type":"play","query":"list này","url":"https://open.spotify.com/..."}
- CHỈ trả về JSON, không giải thích gì thêm`;

/**
 * Parse user message to determine music intent using AI
 */
export async function parseMusicIntent(message: string): Promise<MusicIntent> {
    try {
        // Quick check - if message is too short or generic
        if (message.length < 2) {
            return { type: 'none' };
        }

        const messages = [
            { role: 'system', content: INTENT_SYSTEM_PROMPT },
            { role: 'user', content: message }
        ];

        const response = await client.chatCompletion(messages, 'gemini-3-flash-preview');

        const content = response.choices?.[0]?.message?.content?.trim() || '';
        console.log('[IntentParser] AI response:', content);

        // Parse JSON response
        const jsonMatch = content.match(/\{[^}]+\}/);
        if (!jsonMatch) {
            console.log('[IntentParser] No JSON found in response');
            return { type: 'none' };
        }

        const parsed = JSON.parse(jsonMatch[0]);

        switch (parsed.type) {
            case 'play':
                // Prioritize AI-extracted URL over full query
                const finalQuery = parsed.url || parsed.query || '';
                console.log('[IntentParser] Final query:', finalQuery, '(URL extracted:', !!parsed.url, ')');
                return { type: 'play', query: finalQuery };
            case 'stop':
                return { type: 'stop' };
            case 'skip':
                return { type: 'skip' };
            case 'queue':
                return { type: 'queue' };
            case 'clear':
                return { type: 'clear' };
            case 'leave':
                return { type: 'leave' };
            default:
                return { type: 'none' };
        }
    } catch (error) {
        console.error('[IntentParser] Error:', error);
        return { type: 'none' };
    }
}
