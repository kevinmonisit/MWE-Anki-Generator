import { NextResponse } from "next/server";
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { execSync } from "child_process";

// Force dynamic - never cache this route
export const dynamic = "force-dynamic";

const CARDS_PATH = join(process.cwd(), "user_cards.json");
const OUTPUT_APKG = join(process.cwd(), "user_deck.apkg");
const BUILD_SCRIPT = join(process.cwd(), "scripts", "build_custom_deck.py");

export async function GET() {
  try {
    if (!existsSync(CARDS_PATH)) {
      return NextResponse.json(
        { error: "No cards to export" },
        { status: 400 }
      );
    }

    const cards = JSON.parse(readFileSync(CARDS_PATH, "utf-8"));
    if (!cards.length) {
      return NextResponse.json(
        { error: "No cards to export" },
        { status: 400 }
      );
    }

    // Run the Python build script
    const result = execSync(
      `python3 "${BUILD_SCRIPT}" "${CARDS_PATH}" "${OUTPUT_APKG}"`,
      {
        cwd: process.cwd(),
        timeout: 30000,
        encoding: "utf-8",
      }
    );

    console.log("Build result:", result);

    if (!existsSync(OUTPUT_APKG)) {
      return NextResponse.json(
        { error: "Failed to build deck" },
        { status: 500 }
      );
    }

    const apkgBuffer = readFileSync(OUTPUT_APKG);

    return new NextResponse(apkgBuffer, {
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Disposition": 'attachment; filename="spanish_vocab.apkg"',
        "Content-Length": apkgBuffer.length.toString(),
      },
    });
  } catch (error) {
    console.error("Export error:", error);
    return NextResponse.json(
      { error: "Failed to export deck. Make sure Python and genanki are installed." },
      { status: 500 }
    );
  }
}
