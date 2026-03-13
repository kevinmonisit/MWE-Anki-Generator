"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import type { Segment } from "@/lib/transcript";
import { srtTimeToSeconds } from "@/lib/transcript";
import DeckPreview from "./DeckPreview";

interface PopupState {
  phrase: string;
  segmentId: number;
  x: number;
  y: number;
}

interface ExplanationState {
  loading: boolean;
  text: string | null;
  error: string | null;
}

interface CardState {
  adding: boolean;
  added: boolean;
  duplicate: boolean;
  error: string | null;
}

export default function TranscriptViewer({
  segments,
}: {
  segments: Segment[];
}) {
  const [popup, setPopup] = useState<PopupState | null>(null);
  const [explanation, setExplanation] = useState<ExplanationState>({
    loading: false,
    text: null,
    error: null,
  });
  const [cardState, setCardState] = useState<CardState>({
    adding: false,
    added: false,
    duplicate: false,
    error: null,
  });
  const [cardCount, setCardCount] = useState(0);
  const [exporting, setExporting] = useState(false);
  const [deckOpen, setDeckOpen] = useState(false);
  const [activeSegmentId, setActiveSegmentId] = useState<number | null>(null);

  const popupRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const transcriptRef = useRef<HTMLDivElement>(null);
  const segmentRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const userScrollingRef = useRef(false);
  const userScrollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Precompute segment times for fast lookup
  const segmentTimes = useRef(
    segments.map((s) => ({
      id: s.id,
      start: srtTimeToSeconds(s.start),
      end: srtTimeToSeconds(s.end),
    }))
  );

  // Fetch card count on mount
  useEffect(() => {
    fetch("/api/anki")
      .then((r) => r.json())
      .then((data) => setCardCount(data.count || 0))
      .catch(() => {});
  }, []);

  // Video → Transcript sync via timeupdate
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const onTimeUpdate = () => {
      const t = video.currentTime;
      const times = segmentTimes.current;

      // Binary-ish search: segments are sorted, find the active one
      let found: number | null = null;
      for (let i = 0; i < times.length; i++) {
        if (t >= times[i].start && t <= times[i].end) {
          found = times[i].id;
          break;
        }
        // If we've passed this segment's end and haven't reached the next start,
        // keep the previous segment highlighted
        if (i < times.length - 1 && t > times[i].end && t < times[i + 1].start) {
          found = times[i].id;
          break;
        }
      }

      if (found !== null && found !== activeSegmentId) {
        setActiveSegmentId(found);

        // Auto-scroll to active segment (unless user is manually scrolling)
        if (!userScrollingRef.current) {
          const el = segmentRefs.current.get(found);
          if (el) {
            el.scrollIntoView({ behavior: "smooth", block: "center" });
          }
        }
      }
    };

    video.addEventListener("timeupdate", onTimeUpdate);
    return () => video.removeEventListener("timeupdate", onTimeUpdate);
  }, [activeSegmentId]);

  // Detect user scrolling to pause auto-scroll temporarily
  useEffect(() => {
    const transcript = transcriptRef.current;
    if (!transcript) return;

    const onScroll = () => {
      userScrollingRef.current = true;
      if (userScrollTimeoutRef.current) {
        clearTimeout(userScrollTimeoutRef.current);
      }
      userScrollTimeoutRef.current = setTimeout(() => {
        userScrollingRef.current = false;
      }, 3000); // Resume auto-scroll after 3s of no manual scrolling
    };

    transcript.addEventListener("scroll", onScroll, { passive: true });
    return () => transcript.removeEventListener("scroll", onScroll);
  }, []);

  // Click timestamp → seek video
  const handleSeek = useCallback((segment: Segment) => {
    const video = videoRef.current;
    if (!video) return;
    video.currentTime = srtTimeToSeconds(segment.start);
    video.play();
  }, []);

  const handleMouseUp = useCallback(() => {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || !selection.toString().trim()) {
      return;
    }

    const selectedText = selection.toString().trim();
    if (!selectedText) return;

    const anchorNode = selection.anchorNode;
    if (!anchorNode) return;

    const el =
      anchorNode.nodeType === Node.TEXT_NODE
        ? anchorNode.parentElement
        : (anchorNode as HTMLElement);
    const segmentEl = el?.closest("[data-segment-id]");
    if (!segmentEl) return;

    const segmentId = parseInt(
      segmentEl.getAttribute("data-segment-id") || "0",
      10
    );

    const range = selection.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    const containerRect = containerRef.current?.getBoundingClientRect();

    if (!containerRect) return;

    setPopup({
      phrase: selectedText,
      segmentId,
      x: rect.left + rect.width / 2 - containerRect.left,
      y: rect.top - containerRect.top - 10,
    });
    setExplanation({ loading: false, text: null, error: null });
    setCardState({ adding: false, added: false, duplicate: false, error: null });
  }, []);

  const handleExplain = useCallback(async () => {
    if (!popup) return;

    setExplanation({ loading: true, text: null, error: null });

    const segment = segments.find((s) => s.id === popup.segmentId);
    const segIndex = segments.findIndex((s) => s.id === popup.segmentId);
    const prevSegment = segIndex > 0 ? segments[segIndex - 1] : null;
    const nextSegment =
      segIndex < segments.length - 1 ? segments[segIndex + 1] : null;

    try {
      const res = await fetch("/api/explain", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phrase: popup.phrase,
          sentence: segment?.text || "",
          sentenceBefore: prevSegment?.text || "",
          sentenceAfter: nextSegment?.text || "",
        }),
      });

      if (!res.ok) throw new Error("API request failed");

      const data = await res.json();
      setExplanation({ loading: false, text: data.explanation, error: null });
    } catch {
      setExplanation({
        loading: false,
        text: null,
        error: "Failed to get explanation. Check your API key.",
      });
    }
  }, [popup, segments]);

  const handleAddCard = useCallback(async () => {
    if (!popup || !explanation.text) return;

    setCardState({ adding: true, added: false, duplicate: false, error: null });

    const segment = segments.find((s) => s.id === popup.segmentId);
    const cardData = {
      segmentId: popup.segmentId,
      phrase: popup.phrase,
      sentence: segment?.text || "",
      explanation: explanation.text,
    };

    try {
      // Send directly to Anki via AnkiConnect
      const ankiRes = await fetch("/api/anki/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(cardData),
      });

      const ankiData = await ankiRes.json();

      if (!ankiRes.ok) {
        throw new Error(ankiData.error || "Failed to send to Anki");
      }

      if (ankiData.duplicate) {
        setCardState({ adding: false, added: false, duplicate: true, error: null });
        return;
      }

      // Also save locally for the preview list
      const localRes = await fetch("/api/anki", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(cardData),
      });
      const localData = await localRes.json();
      setCardCount(localData.count);

      setCardState({ adding: false, added: true, duplicate: false, error: null });
    } catch (err) {
      setCardState({
        adding: false,
        added: false,
        duplicate: false,
        error: err instanceof Error ? err.message : "Failed to add card",
      });
    }
  }, [popup, explanation.text, segments]);

  const handleExportDeck = useCallback(async () => {
    setExporting(true);
    try {
      const res = await fetch("/api/anki/export");
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Export failed");
      }

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "spanish_vocab.apkg";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Export failed");
    } finally {
      setExporting(false);
    }
  }, []);

  // Close popup on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (popupRef.current && !popupRef.current.contains(e.target as Node)) {
        setPopup(null);
        setExplanation({ loading: false, text: null, error: null });
        setCardState({ adding: false, added: false, duplicate: false, error: null });
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <div className="flex flex-col h-screen">
      {/* Sticky Video Player */}
      <div className="sticky top-0 z-40 bg-zinc-950 border-b border-zinc-800 shrink-0">
        <div className="max-w-3xl mx-auto">
          <video
            ref={videoRef}
            src="/video.mp4"
            controls
            className="w-full max-h-[45vh] bg-black"
          />
        </div>
      </div>

      {/* Scrollable Transcript Area */}
      <div
        ref={transcriptRef}
        className="flex-1 overflow-y-auto"
      >
        <div className="max-w-3xl mx-auto py-4 px-4">
          <div ref={containerRef} className="relative" onMouseUp={handleMouseUp}>
            {/* Deck preview button - fixed bottom right */}
            {cardCount > 0 && (
              <div className="fixed bottom-6 right-6 z-50">
                <button
                  onClick={() => setDeckOpen(true)}
                  className="bg-zinc-700 hover:bg-zinc-600 text-white font-medium px-4 py-2.5 rounded-lg shadow-lg transition-colors flex items-center gap-2 cursor-pointer"
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    className="w-4 h-4"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"
                    />
                  </svg>
                  {cardCount} card{cardCount !== 1 ? "s" : ""} in Anki
                </button>
              </div>
            )}

            {/* Popup */}
            {popup && (
              <div
                ref={popupRef}
                className="absolute z-50 bg-zinc-800 border border-zinc-600 rounded-lg shadow-2xl px-4 py-3 max-w-sm"
                style={{
                  left: `${popup.x}px`,
                  top: `${popup.y}px`,
                  transform: "translate(-50%, -100%)",
                }}
              >
                {/* Arrow */}
                <div
                  className="absolute left-1/2 -bottom-2 -translate-x-1/2 w-0 h-0"
                  style={{
                    borderLeft: "8px solid transparent",
                    borderRight: "8px solid transparent",
                    borderTop: "8px solid rgb(63 63 70)",
                  }}
                />

                <div className="text-sm font-medium text-amber-400 mb-2">
                  &ldquo;{popup.phrase}&rdquo;
                </div>

                {!explanation.text && !explanation.loading && !explanation.error && (
                  <button
                    onClick={handleExplain}
                    className="bg-amber-600 hover:bg-amber-500 text-white text-sm font-medium px-3 py-1.5 rounded transition-colors cursor-pointer"
                  >
                    Explain in English
                  </button>
                )}

                {explanation.loading && (
                  <div className="text-zinc-400 text-sm flex items-center gap-2">
                    <span className="inline-block w-4 h-4 border-2 border-zinc-500 border-t-amber-400 rounded-full animate-spin" />
                    Thinking...
                  </div>
                )}

                {explanation.text && (
                  <div>
                    <div className="text-sm text-zinc-200 leading-relaxed mb-3">
                      {explanation.text}
                    </div>

                    {/* Add Card Button - bottom right */}
                    <div className="flex justify-end">
                      {cardState.adding ? (
                        <div className="text-zinc-400 text-xs flex items-center gap-1.5">
                          <span className="inline-block w-3 h-3 border-2 border-zinc-500 border-t-green-400 rounded-full animate-spin" />
                          Sending to Anki...
                        </div>
                      ) : cardState.added ? (
                        <div className="text-green-400 text-xs flex items-center gap-1">
                          <svg
                            xmlns="http://www.w3.org/2000/svg"
                            className="w-3.5 h-3.5"
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                            strokeWidth={2}
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              d="M5 13l4 4L19 7"
                            />
                          </svg>
                          Sent to Anki!
                        </div>
                      ) : cardState.duplicate ? (
                        <div className="text-yellow-400 text-xs">
                          Already in Anki
                        </div>
                      ) : cardState.error ? (
                        <div className="text-red-400 text-xs">{cardState.error}</div>
                      ) : (
                        <button
                          onClick={handleAddCard}
                          className="bg-green-600 hover:bg-green-500 text-white text-xs font-medium px-2.5 py-1 rounded transition-colors cursor-pointer flex items-center gap-1"
                        >
                          <svg
                            xmlns="http://www.w3.org/2000/svg"
                            className="w-3.5 h-3.5"
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                            strokeWidth={2}
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              d="M12 4v16m8-8H4"
                            />
                          </svg>
                          Send to Anki
                        </button>
                      )}
                    </div>
                  </div>
                )}

                {explanation.error && (
                  <div className="text-sm text-red-400">{explanation.error}</div>
                )}
              </div>
            )}

            {/* Transcript */}
            <div className="space-y-1">
              {segments.map((segment) => (
                <div
                  key={segment.id}
                  data-segment-id={segment.id}
                  ref={(el) => {
                    if (el) segmentRefs.current.set(segment.id, el);
                  }}
                  className={`group flex gap-3 py-2 px-3 rounded-lg transition-colors ${
                    activeSegmentId === segment.id
                      ? "bg-amber-600/15 border-l-2 border-amber-500"
                      : "hover:bg-zinc-900/50 border-l-2 border-transparent"
                  }`}
                >
                  <button
                    onClick={() => handleSeek(segment)}
                    className={`text-xs font-mono pt-1 shrink-0 w-20 select-none text-left cursor-pointer hover:text-amber-400 transition-colors ${
                      activeSegmentId === segment.id
                        ? "text-amber-500"
                        : "text-zinc-600"
                    }`}
                  >
                    {segment.start.replace(/,\d+$/, "")}
                  </button>
                  <p className={`leading-relaxed text-[15px] cursor-text selection:bg-amber-600/40 ${
                    activeSegmentId === segment.id
                      ? "text-zinc-100"
                      : "text-zinc-200"
                  }`}>
                    {segment.text}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Deck Preview Modal */}
      <DeckPreview
        open={deckOpen}
        onClose={() => setDeckOpen(false)}
        onCardCountChange={setCardCount}
      />
    </div>
  );
}
