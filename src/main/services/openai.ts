import path from 'path';
import fs from 'fs';
import { net } from 'electron';

export function loadOpenAIKey(): string {
  try {
    const envPath = path.join(__dirname, '..', '..', '..', '..', '.env.local');
    const envContent = fs.readFileSync(envPath, 'utf-8');
    const match = envContent.match(/^OPENAI_API_KEY=(.+)$/m);
    return match ? match[1].trim() : '';
  } catch {
    return '';
  }
}

export async function openaiChat(
  apiKey: string,
  messages: { role: string; content: string }[],
  opts: { model?: string; maxTokens?: number; temperature?: number } = {}
): Promise<{
  content: string;
  usage?: { prompt_tokens: number; completion_tokens: number };
  model?: string;
  error?: string;
}> {
  const model = opts.model || 'gpt-5.4';
  const response = await net.fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages,
      max_completion_tokens: opts.maxTokens || 300,
      temperature: opts.temperature ?? 0.3,
    }),
  });

  const json = await response.json() as {
    choices?: { message?: { content?: string } }[];
    usage?: { prompt_tokens: number; completion_tokens: number };
    model?: string;
    error?: { message?: string };
  };

  if (json.error) {
    return { content: '', error: json.error.message || 'OpenAI API error' };
  }

  return {
    content: json.choices?.[0]?.message?.content?.trim() || '',
    usage: json.usage,
    model: json.model,
  };
}
