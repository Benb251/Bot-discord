import { AntigravityClient } from './AntigravityClient';

// Intent types for music commands
export type MusicIntent =
    | { type: 'play'; query: string; url?: string }
    | { type: 'stop' }
    | { type: 'skip' }
    | { type: 'queue' }
    | { type: 'clear' }
    | { type: 'leave' }
    | { type: 'none' }; // Not a music command

// System prompt for intent parsing
const INTENT_SYSTEM_PROMPT = `Bạn là một AI phân tích ý định người dùng cho bot Discord phát nhạc.

Phân tích tin nhắn và trả về JSON với format:
{"type": "play|stop|skip|queue|clear|leave|none", "query": "tên bài hát nếu có", "url": "URL nếu có"}

Các ý định:
- "play": Người dùng muốn phát nhạc, **kể cả khi yêu cầu chung chung** (ví dụ: "bật nhạc chill", "mở bài gì buồn buồn", "nhạc lofi đi").
- "stop": Dừng/tắt nhạc.
- "skip": Bỏ qua bài.
- "queue": Xem danh sách.
- "clear": Xóa queue.
- "leave": Rời kênh.
- "none": Chỉ là chat, hỏi đáp, không liên quan đến việc mở nhạc ngay lập tức.

Lưu ý:
- "mở bài gì chill chill đi" -> {"type":"play", "query":"nhạc chill"}
- "bật nhạc học bài" -> {"type":"play", "query":"lofi study"}
- CHỈ trả về JSON.`;

export class IntentParser {
    private client: AntigravityClient;

    constructor(client: AntigravityClient) {
        this.client = client;
    }

    /**
     * Parse user message to determine music intent using AI
     */
    async parse(message: string): Promise<MusicIntent> {
        try {
            // Quick check - if message is too short or generic
            if (message.length < 2) {
                return { type: 'none' };
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

            // Parse JSON response key-by-key to be safe
            const jsonMatch = content.match(/\{[\s\S]*\}/);
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
                    return { type: 'play', query: finalQuery, url: parsed.url };
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
}
