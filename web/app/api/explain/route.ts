import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export async function POST(req: NextRequest) {
  try {
    const { phrase, sentenceBefore, sentence, sentenceAfter } = await req.json();

    if (!phrase || !sentence) {
      return NextResponse.json(
        { error: "Missing phrase or sentence" },
        { status: 400 }
      );
    }

    const prompt = `You are a Spanish language tutor helping an English speaker understand spoken Mexican Spanish.

The student selected the phrase: "${phrase}"

Context:
${sentenceBefore ? `Previous sentence: "${sentenceBefore}"` : ""}
Current sentence: "${sentence}"
${sentenceAfter ? `Next sentence: "${sentenceAfter}"` : ""}

Explain in English what "${phrase}" means in this context. Include:
1. The literal translation
2. What it actually means/implies in this conversational context
3. Any slang, colloquial usage, or cultural notes if relevant

Keep it concise (2-4 sentences). Be natural and helpful, not academic.`;

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      max_tokens: 300,
      temperature: 0.7,
    });

    const explanation =
      completion.choices[0]?.message?.content || "No explanation available.";

    return NextResponse.json({ explanation });
  } catch (error) {
    console.error("OpenAI API error:", error);
    return NextResponse.json(
      { error: "Failed to generate explanation" },
      { status: 500 }
    );
  }
}
