import axios from 'axios';

export class AntigravityClient {
    private baseURL: string;

    constructor(baseURL: string = 'http://localhost:8317/v1') {
        this.baseURL = baseURL;
    }

    public async chatCompletion(messages: any[], model: string = 'gemini-2.0-flash-exp') {
        try {
            console.log(`[AntigravityClient] Sending request to ${this.baseURL} [Model: ${model}]...`);

            const response = await axios.post(
                `${this.baseURL}/chat/completions`,
                {
                    model: model,
                    messages: messages,
                    stream: false
                },
                {
                    headers: {
                        'Authorization': 'Bearer proxypal-local',
                        'Content-Type': 'application/json'
                    },
                    timeout: 120000 // Extended timeout for Thinking models
                }
            );

            return response.data;

        } catch (error: any) {
            console.error(`[AntigravityClient] Request failed:`, error.message);
            if (error.response) {
                console.error(`Status: ${error.response.status}`);
                console.error(`Data:`, JSON.stringify(error.response.data, null, 2));
            }
            throw error;
        }
    }

    // Streaming version - yields chunks as they arrive
    public async *chatCompletionStream(messages: any[], model: string = 'gemini-3-flash-preview'): AsyncGenerator<string> {
        console.log(`[AntigravityClient] Streaming request to ${this.baseURL} [Model: ${model}]...`);

        const response = await axios.post(
            `${this.baseURL}/chat/completions`,
            {
                model: model,
                messages: messages,
                stream: true
            },
            {
                headers: {
                    'Authorization': 'Bearer proxypal-local',
                    'Content-Type': 'application/json'
                },
                responseType: 'stream',
                timeout: 120000
            }
        );

        const stream = response.data;
        let buffer = '';

        for await (const chunk of stream) {
            buffer += chunk.toString();
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
                if (line.startsWith('data: ')) {
                    const data = line.slice(6);
                    if (data === '[DONE]') return;
                    try {
                        const parsed = JSON.parse(data);
                        const content = parsed.choices?.[0]?.delta?.content;
                        if (content) {
                            yield content;
                        }
                    } catch (e) {
                        // Skip invalid JSON
                    }
                }
            }
        }
    }
}
