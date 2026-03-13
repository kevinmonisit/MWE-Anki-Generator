import { NextRequest, NextResponse } from "next/server";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";

// Force dynamic - never cache this route
export const dynamic = "force-dynamic";

const CARDS_PATH = join(process.cwd(), "output", "user_cards.json");

function readCards(): Array<{
  segmentId: number;
  phrase: string;
  sentence: string;
  explanation: string;
  addedAt: string;
}> {
  if (!existsSync(CARDS_PATH)) return [];
  try {
    return JSON.parse(readFileSync(CARDS_PATH, "utf-8"));
  } catch {
    return [];
  }
}

function writeCards(cards: unknown[]) {
  mkdirSync(join(process.cwd(), "output"), { recursive: true });
  writeFileSync(CARDS_PATH, JSON.stringify(cards, null, 2), "utf-8");
}

// GET - list current cards
export async function GET() {
  const cards = readCards();
  return NextResponse.json({ cards, count: cards.length });
}

// POST - add a card
export async function POST(req: NextRequest) {
  try {
    const { segmentId, phrase, sentence, explanation } = await req.json();

    if (!segmentId || !phrase || !sentence || !explanation) {
      return NextResponse.json(
        { error: "Missing required fields: segmentId, phrase, sentence, explanation" },
        { status: 400 }
      );
    }

    const cards = readCards();

    // Check for duplicate (same segment + phrase)
    const isDuplicate = cards.some(
      (c) => c.segmentId === segmentId && c.phrase === phrase
    );
    if (isDuplicate) {
      return NextResponse.json(
        { message: "Card already exists", duplicate: true, count: cards.length },
        { status: 200 }
      );
    }

    cards.push({
      segmentId,
      phrase,
      sentence,
      explanation,
      addedAt: new Date().toISOString(),
    });

    writeCards(cards);

    return NextResponse.json({
      message: "Card added",
      count: cards.length,
    });
  } catch (error) {
    console.error("Add card error:", error);
    return NextResponse.json(
      { error: "Failed to add card" },
      { status: 500 }
    );
  }
}

// DELETE - remove a card or clear all
export async function DELETE(req: NextRequest) {
  try {
    const { segmentId, phrase, clearAll } = await req.json();

    if (clearAll) {
      writeCards([]);
      return NextResponse.json({ message: "All cards cleared", count: 0 });
    }

    if (!segmentId || !phrase) {
      return NextResponse.json(
        { error: "Missing segmentId or phrase" },
        { status: 400 }
      );
    }

    const cards = readCards();
    const filtered = cards.filter(
      (c) => !(c.segmentId === segmentId && c.phrase === phrase)
    );
    writeCards(filtered);

    return NextResponse.json({
      message: "Card removed",
      count: filtered.length,
    });
  } catch (error) {
    console.error("Delete card error:", error);
    return NextResponse.json(
      { error: "Failed to delete card" },
      { status: 500 }
    );
  }
}
