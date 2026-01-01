import { AntigravityClient } from './AntigravityClient';

// Intent types for music commands
export type MusicIntent =
    | { type: 'play'; query: string; url?: string }
    | { type: 'stop' }
    | { type: 'skip' }
    | { type: 'queue' }
    | { type: 'clear' }
    | { type: 'leave' }
    | { type: 'autoplay' }
    | { type: 'cleanup' }
    | { type: 'none' }; // Not a music command

// System prompt for intent parsing
const INTENT_SYSTEM_PROMPT = `Bạn là một AI phân tích ý định người dùng cho bot Discord phát nhạc.

Phân tích tin nhắn và trả về JSON ARRAY (Danh sách) các ý định:
[{"type": "play|stop|skip|queue|clear|leave|autoplay|cleanup|none", "query": "...", "url": "..."}]

Nếu người dùng yêu cầu NHIỀU hành động (ví dụ: "skip bài này và mở bài ABC"), hãy trả về NHIỀU object trong mảng theo thứ tự.

Các ý định:
- "play": Người dùng muốn phát nhạc, **kể cả khi yêu cầu chung chung**.
- "stop": Dừng/tắt nhạc.
- "skip": Bỏ qua bài.
- "queue": Xem danh sách.
- "clear": Xóa queue.
- "leave": Rời kênh.
- "autoplay": Bật/tắt chế độ tự động.
- "cleanup": Xóa tin nhắn bot (khi có từ khóa "xóa", "dọn", "spam").
- "none": Không liên quan.

Ví dụ:
- "mở bài gì chill chill đi" -> [{"type":"play", "query":"nhạc chill"}]
- "skip bài này rồi mở nhạc sếp tùng" -> [{"type":"skip"}, {"type":"play", "query":"nhạc sơn tùng mtp"}]
- "dừng lại và xóa queue" -> [{"type":"stop"}, {"type":"clear"}]
- "spam quá xóa đi" -> [{"type":"cleanup"}]

CHỈ trả về JSON.`;

export class IntentParser {
    private client: AntigravityClient;

    constructor(client: AntigravityClient) {
        this.client = client;
    }

    /**
     * Parse user message to determine music intent using AI
     */
    async parse(message: string): Promise<MusicIntent[]> {
        try {
            // Quick check - if message is too short or generic
            if (message.length < 2) {
                return [{ type: 'none' }];
            }

            const messages = [
                { role: 'system', content: INTENT_SYSTEM_PROMPT },
                { role: 'user', content: message }
            ];

            // Try primary model first (Gemini 3 Flash), fallback to Gemini 2.5 Flash if it fails
            let response;
            try {
                response = await this.client.chatCompletion(messages, 'gemini-3-flash-preview');
            } catch (err) {
                console.warn('[IntentParser] Failed to use 3.0 Flash, falling back to 2.5 Flash...');
                response = await this.client.chatCompletion(messages, 'gemini-2.5-flash');
            }

            const content = response.choices?.[0]?.message?.content?.trim() || '';
            console.log('[IntentParser] AI response:', content);

            // Parse JSON response which might be an object OR an array
            const jsonMatch = content.match(/\[[\s\S]*\]/) || content.match(/\{[\s\S]*\}/);

            if (!jsonMatch) {
                console.log('[IntentParser] No JSON found in response');
                return [{ type: 'none' }];
            }

            let parsed = JSON.parse(jsonMatch[0]);

            // Ensure it's an array
            if (!Array.isArray(parsed)) {
                parsed = [parsed];
            }

            // Map to strict types
            return parsed.map((item: any) => {
                switch (item.type) {
                    case 'play':
                        const finalQuery = item.url || item.query || '';
                        return { type: 'play', query: finalQuery, url: item.url };
                    case 'stop': return { type: 'stop' };
                    case 'skip': return { type: 'skip' };
                    case 'queue': return { type: 'queue' };
                    case 'clear': return { type: 'clear' };
                    case 'leave': return { type: 'leave' };
                    case 'autoplay': return { type: 'autoplay' };
                    case 'cleanup': return { type: 'cleanup' };
                    default: return { type: 'none' };
                }
            });

        } catch (error) {
            console.error('[IntentParser] Error:', error);
            return [{ type: 'none' }];
        }
    }
}

