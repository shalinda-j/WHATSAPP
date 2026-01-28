
export interface AIChatMessage {
    role: 'system' | 'user' | 'assistant';
    content: string;
}

export interface AIService {
    name: string;
    generateResponse(messages: AIChatMessage[]): Promise<string>;
}
