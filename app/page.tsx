import { readFileSync } from "fs";
import { join } from "path";
import { parseSRT } from "@/lib/transcript";
import TranscriptViewer from "@/components/TranscriptViewer";

export default function Home() {
  const srtPath = join(process.cwd(), "output", "video.srt");
  const srtContent = readFileSync(srtPath, "utf-8");
  const segments = parseSRT(srtContent);

  return (
    <main className="h-screen bg-zinc-950 text-zinc-100 overflow-hidden">
      <TranscriptViewer segments={segments} />
    </main>
  );
}
