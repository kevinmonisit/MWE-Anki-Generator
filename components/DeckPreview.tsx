"use client";

import { useState, useCallback, useEffect } from "react";

interface Card {
  segmentId: number;
  phrase: string;
  sentence: string;
  explanation: string;
  addedAt: string;
}

export default function DeckPreview({
  open,
  onClose,
  onCardCountChange,
}: {
  open: boolean;
  onClose: () => void;
  onCardCountChange: (count: number) => void;
}) {
  const [cards, setCards] = useState<Card[]>([]);
  const [loading, setLoading] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [resetting, setResetting] = useState(false);
  const [previewCard, setPreviewCard] = useState<Card | null>(null);
  const [sendingAll, setSendingAll] = useState(false);
  const [sendAllResult, setSendAllResult] = useState<{
    sent: number;
    dupes: number;
    errors: number;
  } | null>(null);
  const [exporting, setExporting] = useState(false);

  const fetchCards = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/anki");
      const data = await res.json();
      setCards(data.cards || []);
      onCardCountChange(data.count || 0);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [onCardCountChange]);

  useEffect(() => {
    if (open) {
      fetchCards();
      setSendAllResult(null);
    }
  }, [open, fetchCards]);

  const handleDelete = useCallback(
    async (card: Card) => {
      const key = `${card.segmentId}:${card.phrase}`;
      setDeleting(key);
      try {
        const res = await fetch("/api/anki", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            segmentId: card.segmentId,
            phrase: card.phrase,
          }),
        });
        const data = await res.json();
        setCards((prev) =>
          prev.filter(
            (c) => !(c.segmentId === card.segmentId && c.phrase === card.phrase)
          )
        );
        onCardCountChange(data.count ?? cards.length - 1);
        if (
          previewCard &&
          previewCard.segmentId === card.segmentId &&
          previewCard.phrase === card.phrase
        ) {
          setPreviewCard(null);
        }
      } catch {
        // ignore
      } finally {
        setDeleting(null);
      }
    },
    [cards.length, onCardCountChange, previewCard]
  );

  const handleResetAll = useCallback(async () => {
    if (!confirm("Delete ALL cards from the local list? This cannot be undone.\n\nNote: Cards already sent to Anki will remain in Anki.")) return;
    setResetting(true);
    try {
      await fetch("/api/anki", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clearAll: true }),
      });
      setCards([]);
      onCardCountChange(0);
      setPreviewCard(null);
    } catch {
      // ignore
    } finally {
      setResetting(false);
    }
  }, [onCardCountChange]);

  const handleSendAllToAnki = useCallback(async () => {
    setSendingAll(true);
    setSendAllResult(null);
    let sent = 0;
    let dupes = 0;
    let errors = 0;

    for (const card of cards) {
      try {
        const res = await fetch("/api/anki/send", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            segmentId: card.segmentId,
            phrase: card.phrase,
            sentence: card.sentence,
            explanation: card.explanation,
          }),
        });
        const data = await res.json();
        if (!res.ok) {
          errors++;
        } else if (data.duplicate) {
          dupes++;
        } else {
          sent++;
        }
      } catch {
        errors++;
      }
    }

    setSendAllResult({ sent, dupes, errors });
    setSendingAll(false);
  }, [cards]);

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

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Panel */}
      <div className="relative w-full max-w-2xl max-h-[80vh] mx-4 bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-700 shrink-0">
          <div className="flex items-center gap-3">
            <h2 className="text-lg font-semibold text-zinc-100">
              Deck Preview
            </h2>
            <span className="text-xs bg-zinc-700 text-zinc-300 px-2 py-0.5 rounded-full">
              {cards.length} card{cards.length !== 1 ? "s" : ""}
            </span>
          </div>
          <div className="flex items-center gap-2">
            {cards.length > 0 && (
              <button
                onClick={handleResetAll}
                disabled={resetting}
                className="text-xs text-red-400 hover:text-red-300 disabled:text-zinc-600 px-2 py-1 rounded hover:bg-red-400/10 transition-colors cursor-pointer"
              >
                {resetting ? "Clearing..." : "Reset All"}
              </button>
            )}
            <button
              onClick={onClose}
              className="text-zinc-400 hover:text-zinc-200 p-1 rounded hover:bg-zinc-700 transition-colors cursor-pointer"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="w-5 h-5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <span className="inline-block w-6 h-6 border-2 border-zinc-600 border-t-amber-400 rounded-full animate-spin" />
            </div>
          ) : cards.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-zinc-500">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="w-12 h-12 mb-3 text-zinc-600"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={1.5}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"
                />
              </svg>
              <p className="text-sm">No cards yet</p>
              <p className="text-xs text-zinc-600 mt-1">
                Select a phrase, get an explanation, then click &quot;Send to Anki&quot;
              </p>
            </div>
          ) : (
            <div className="divide-y divide-zinc-800">
              {cards.map((card) => {
                const key = `${card.segmentId}:${card.phrase}`;
                const isDeleting = deleting === key;
                const isPreviewing =
                  previewCard?.segmentId === card.segmentId &&
                  previewCard?.phrase === card.phrase;

                return (
                  <div key={key} className="group">
                    {/* Card row */}
                    <div className="flex items-start gap-3 px-5 py-3 hover:bg-zinc-800/50 transition-colors">
                      {/* Thumbnail */}
                      <img
                        src={`/img/${String(card.segmentId).padStart(4, "0")}.jpg`}
                        alt=""
                        className="w-16 h-10 object-cover rounded shrink-0 mt-0.5"
                      />

                      {/* Info */}
                      <div
                        className="flex-1 min-w-0 cursor-pointer"
                        onClick={() =>
                          setPreviewCard(isPreviewing ? null : card)
                        }
                      >
                        <div className="text-sm font-medium text-amber-400 truncate">
                          &ldquo;{card.phrase}&rdquo;
                        </div>
                        <div className="text-xs text-zinc-400 truncate mt-0.5">
                          {card.sentence}
                        </div>
                      </div>

                      {/* Delete button */}
                      <button
                        onClick={() => handleDelete(card)}
                        disabled={isDeleting}
                        className="shrink-0 p-1.5 text-zinc-500 hover:text-red-400 hover:bg-red-400/10 rounded transition-colors opacity-0 group-hover:opacity-100 cursor-pointer disabled:opacity-50"
                        title="Remove card"
                      >
                        {isDeleting ? (
                          <span className="inline-block w-4 h-4 border-2 border-zinc-600 border-t-red-400 rounded-full animate-spin" />
                        ) : (
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
                              d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                            />
                          </svg>
                        )}
                      </button>
                    </div>

                    {/* Expanded card preview (simulates Anki front/back) */}
                    {isPreviewing && (
                      <div className="px-5 pb-4">
                        <div className="bg-zinc-800 rounded-lg border border-zinc-700 overflow-hidden">
                          {/* Front side */}
                          <div className="p-4 text-center">
                            <div className="text-[10px] uppercase tracking-wider text-zinc-500 mb-2">
                              Front
                            </div>
                            <img
                              src={`/img/${String(card.segmentId).padStart(4, "0")}.jpg`}
                              alt=""
                              className="max-h-40 mx-auto rounded mb-3"
                            />
                            <audio
                              controls
                              src={`/audio/${String(card.segmentId).padStart(4, "0")}.mp3`}
                              className="mx-auto mb-2 h-8"
                            />
                            <div className="text-base text-zinc-200">
                              {card.sentence}
                            </div>
                          </div>

                          {/* Divider */}
                          <div className="border-t border-amber-600/40 mx-8" />

                          {/* Back side */}
                          <div className="p-4 text-center">
                            <div className="text-[10px] uppercase tracking-wider text-zinc-500 mb-2">
                              Back
                            </div>
                            <div className="text-lg font-semibold text-amber-400 mb-2">
                              &ldquo;{card.phrase}&rdquo;
                            </div>
                            <div className="text-sm text-zinc-300 leading-relaxed text-left max-w-md mx-auto">
                              {card.explanation}
                            </div>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer with actions */}
        {cards.length > 0 && (
          <div className="border-t border-zinc-700 px-5 py-3 flex items-center justify-between shrink-0">
            {/* Send All result */}
            <div className="text-xs text-zinc-400">
              {sendAllResult ? (
                <span>
                  {sendAllResult.sent > 0 && (
                    <span className="text-green-400">
                      {sendAllResult.sent} sent
                    </span>
                  )}
                  {sendAllResult.dupes > 0 && (
                    <span className="text-yellow-400">
                      {sendAllResult.sent > 0 ? ", " : ""}
                      {sendAllResult.dupes} already in Anki
                    </span>
                  )}
                  {sendAllResult.errors > 0 && (
                    <span className="text-red-400">
                      {sendAllResult.sent > 0 || sendAllResult.dupes > 0
                        ? ", "
                        : ""}
                      {sendAllResult.errors} failed
                    </span>
                  )}
                </span>
              ) : (
                <span>Cards are sent to Anki when you click &quot;Send to Anki&quot; in the popup.</span>
              )}
            </div>

            <div className="flex items-center gap-2">
              {/* Download .apkg fallback */}
              <button
                onClick={handleExportDeck}
                disabled={exporting}
                className="text-xs text-zinc-400 hover:text-zinc-200 disabled:text-zinc-600 px-3 py-1.5 rounded hover:bg-zinc-700 transition-colors cursor-pointer"
                title="Download as .apkg file"
              >
                {exporting ? "Building..." : "Download .apkg"}
              </button>

              {/* Send All to Anki */}
              <button
                onClick={handleSendAllToAnki}
                disabled={sendingAll}
                className="bg-green-600 hover:bg-green-500 disabled:bg-zinc-600 text-white text-sm font-medium px-4 py-1.5 rounded-lg transition-colors flex items-center gap-2 cursor-pointer"
              >
                {sendingAll ? (
                  <>
                    <span className="inline-block w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    Sending...
                  </>
                ) : (
                  <>
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
                        d="M7 11l5-5m0 0l5 5m-5-5v12"
                      />
                    </svg>
                    Send All to Anki
                  </>
                )}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
