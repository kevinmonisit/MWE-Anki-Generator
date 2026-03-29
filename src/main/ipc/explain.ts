import { ipcMain } from 'electron';
import { openaiChat } from '../services/openai';
import type { ExplainParams } from '../../shared/types';

export function registerExplainHandlers(
  getApiKey: () => string,
  trackCost: (model: string, promptTokens: number, completionTokens: number, source: string) => void
): void {
  ipcMain.handle('openai-explain', async (_event, params: ExplainParams) => {
    const apiKey = getApiKey();
    if (!apiKey) {
      return { success: false, error: 'OpenAI API key not found in .env.local' };
    }

    const { selectedText, fullSentence, sentenceBefore, sentenceAfter } = params;

    const prompt = `You are a Mexican Spanish language API that explains the specific nuance of specified word(s) in a sentence. The student selected: "${selectedText}"

It appears in this sentence: "${fullSentence}"

Surrounding context (6 sentences before and after):
Before: "${sentenceBefore}"
Current line: "${fullSentence}"
After: "${sentenceAfter}"

Respond with a JSON object (no markdown, no code fences) with exactly two fields:
- "explanation": Respond concisely in no more than 100 words. The specified word(s)/phrases MUST be in their original Spanish. All other explanation text MUST be in English. Use Mexican Spanish. Write an explanation that helps someone understand the word, phrase, or idiom and how it is used in this context, as though you're explaining it to a friend. Use the surrounding context to clarify how the phrase is being used in this specific moment. DO NOT output the word 'nuance'. DO NOT use complicated words. Explain the essence of the word in its context to an intermediate to advanced Spanish learner. DO NOT avoid direct explanations for tricky or slang meanings; explain them as they are. DO NOT overcomplicate with grammar jargon; keep it natural and simple. Conclude with the specific meaning within the context sentence.
- "translation": a natural English translation of the ENTIRE current line "${fullSentence}" (not just the selected part — translate the whole sentence).

Example format: {"explanation":"...","translation":"..."}`;

    try {
      const result = await openaiChat(apiKey, [{ role: 'user', content: prompt }], { model: 'gpt-5.4', maxTokens: 300 });

      if (result.error) {
        return { success: false, error: result.error };
      }

      if (result.usage) {
        trackCost(result.model || 'gpt-5.4', result.usage.prompt_tokens, result.usage.completion_tokens, 'explain');
      }

      const raw = result.content || '{}';
      let translation = '';
      let explanation = '';
      try {
        const parsed = JSON.parse(raw) as { translation?: string; explanation?: string };
        translation = parsed.translation?.trim() || '';
        explanation = parsed.explanation?.trim() || '';
      } catch {
        explanation = raw;
      }
      if (!explanation && !translation) explanation = 'No explanation returned.';
      return { success: true, translation, explanation };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });

  ipcMain.handle('get-cloze-hint', async (_event, params: { selectedText: string; fullSentence: string; translation: string }) => {
    try {
      const hint = await getClozeHint(getApiKey(), params.selectedText, params.fullSentence, params.translation, trackCost);
      return { success: true, hint };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });
}

export async function getClozeHint(
  apiKey: string,
  selectedText: string,
  fullSentence: string,
  translation: string,
  trackCost: (model: string, promptTokens: number, completionTokens: number, source: string) => void
): Promise<string> {
  if (!apiKey) return translation || 'hint';

  const prompt = `Give me a 1-3 word English translation for the Spanish word/phrase "${selectedText}" as used in "${fullSentence}". The full sentence translates to: "${translation}". Respond with ONLY the short English equivalent, nothing else. Use the most natural, succinct word a native English speaker would use. For example: "apostando" → "betting", "castigo" → "punishment", "ponerse" → "to put on". Keep it as short as possible — ideally one word.`;

  try {
    const result = await openaiChat(apiKey, [{ role: 'user', content: prompt }], { model: 'gpt-5.4-mini', maxTokens: 30 });

    if (result.usage) {
      trackCost(result.model || 'gpt-5.4-mini', result.usage.prompt_tokens, result.usage.completion_tokens, 'cloze-hint');
    }

    return result.content || translation || 'hint';
  } catch {
    return translation || 'hint';
  }
}
