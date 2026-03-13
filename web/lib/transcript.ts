export interface Segment {
  id: number;
  start: string;
  end: string;
  text: string;
}

/** Convert SRT timestamp "00:01:23,456" to seconds (83.456) */
export function srtTimeToSeconds(t: string): number {
  const [h, m, rest] = t.split(":");
  const [s, ms] = rest.split(",");
  return parseInt(h) * 3600 + parseInt(m) * 60 + parseInt(s) + parseInt(ms) / 1000;
}

export function parseSRT(srt: string): Segment[] {
  const segments: Segment[] = [];
  const blocks = srt.trim().split(/\n\n+/);

  for (const block of blocks) {
    const lines = block.split("\n");
    if (lines.length < 3) continue;

    const id = parseInt(lines[0], 10);
    const timeLine = lines[1];
    const text = lines.slice(2).join(" ").trim();

    const match = timeLine.match(
      /(\d{2}:\d{2}:\d{2},\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2},\d{3})/
    );
    if (!match) continue;

    segments.push({
      id,
      start: match[1],
      end: match[2],
      text,
    });
  }

  return segments;
}
