import { useCallback, useEffect, useMemo, useState } from "react";
import type { ResultEvent } from "../types/audio";
import type { PracticeSongState, SongEvent } from "../types/song";
import { loadSong } from "../services/musicXmlParser";
import { pitchClassToName } from "../utils/pitch";

export type PracticeLogEntry = {
  id: string;
  type: "match" | "miss";
  message: string;
};

export type PracticeSessionState = {
  songState: PracticeSongState;
  currentEvent: SongEvent | null;
  stats: {
    matches: number;
    attempts: number;
  };
  progress: {
    index: number;
    total: number;
  };
  isComplete: boolean;
  log: PracticeLogEntry[];
  registerResult: (event: ResultEvent) => void;
  resetSession: () => void;
};

const SONG_PATH = "/songs/song-of-storms.musicxml";

export function usePracticeSession(songPath = SONG_PATH): PracticeSessionState {
  const [songState, setSongState] = useState<PracticeSongState>({
    status: "loading",
  });
  const [currentIndex, setCurrentIndex] = useState(0);
  const [stats, setStats] = useState({ matches: 0, attempts: 0 });
  const [isComplete, setComplete] = useState(false);
  const [log, setLog] = useState<PracticeLogEntry[]>([]);

  useEffect(() => {
    let isMounted = true;
    setSongState({ status: "loading" });
    loadSong(songPath)
      .then((song) => {
        if (!isMounted) return;
        setSongState({ status: "ready", song });
        setCurrentIndex(0);
        setStats({ matches: 0, attempts: 0 });
        setComplete(false);
        setLog([]);
      })
      .catch((err) => {
        if (!isMounted) return;
        setSongState({ status: "error", message: err.message ?? String(err) });
      });
    return () => {
      isMounted = false;
    };
  }, [songPath]);

  const currentEvent = useMemo(() => {
    if (songState.status !== "ready") return null;
    return songState.song.events[currentIndex] ?? null;
  }, [songState, currentIndex]);

  const totalEvents = songState.status === "ready" ? songState.song.events.length : 0;

  const resetSession = useCallback(() => {
    if (songState.status !== "ready") return;
    setCurrentIndex(0);
    setStats({ matches: 0, attempts: 0 });
    setComplete(false);
    setLog([]);
  }, [songState.status]);

  const registerResult = useCallback(
    (event: ResultEvent) => {
      if (songState.status !== "ready") return;
      if (event.type === "CHORD_MATCH") {
        setStats((prev) => ({ matches: prev.matches + 1, attempts: prev.attempts + 1 }));
        setLog((prev) =>
          [
            {
              id: `${event.t}-match-${prev.length}`,
              type: "match" as const,
              message: `Matched ${currentEvent?.label ?? "target"}`,
            },
            ...prev,
          ].slice(0, 30)
        );
        setCurrentIndex((idx) => {
          const nextIdx = idx + 1;
          if (nextIdx >= totalEvents) {
            setComplete(true);
            return idx; // stay on last event when complete
          }
          return nextIdx;
        });
      } else if (event.type === "CHORD_MISS") {
        setStats((prev) => ({ ...prev, attempts: prev.attempts + 1 }));
        const missingNames = event.missing.map(pitchClassToName).join(", ");
        const haveNames = event.matched.map(pitchClassToName).join(", ");
        setLog((prev) =>
          [
            {
              id: `${event.t}-miss-${prev.length}`,
              type: "miss" as const,
              message: `Need ${missingNames || "all"}; have ${haveNames || "none"}`,
            },
            ...prev,
          ].slice(0, 30)
        );
      }
    },
    [songState.status, totalEvents, currentEvent]
  );

  return {
    songState,
    currentEvent,
    stats,
    progress: { index: currentIndex, total: totalEvents },
    isComplete,
    log,
    registerResult,
    resetSession,
  };
}
