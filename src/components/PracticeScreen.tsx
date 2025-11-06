import { useCallback, useEffect } from "react";
import type { PitchClass } from "../types/audio";
import useChordVerifier from "../hooks/useChordVerifier";
import { usePracticeSession } from "../hooks/usePracticeSession";
import { pitchClassToName } from "../utils/pitch";

const DEFAULT_EXPECTED = {
  name: "E minor",
  pcs: [4, 7, 11] as PitchClass[],
  K: 2,
};

export default function PracticeScreen() {
  const session = usePracticeSession();
  const { songState, currentEvent, stats, progress, log, isComplete, registerResult, resetSession } = session;

  const {
    status: detectorStatus,
    errorMessage,
    start,
    stop,
    setExpected,
  } = useChordVerifier({
    expected: currentEvent?.chordSpec ?? DEFAULT_EXPECTED,
    onResult: (event) => {
      registerResult(event);
    },
  });

  useEffect(() => {
    if (currentEvent) {
      setExpected(currentEvent.chordSpec);
    }
  }, [currentEvent, setExpected]);

  useEffect(() => {
    if (isComplete) {
      stop();
    }
  }, [isComplete, stop]);

  const songTitle =
    songState.status === "ready" ? songState.song.title : "Loading song";
  const tempo =
    songState.status === "ready" ? songState.song.tempo : undefined;

  const currentTargetText = currentEvent
    ? currentEvent.chordSpec.pcs.map(pitchClassToName).join(", ")
    : "—";

  const accuracy = stats.attempts
    ? Math.round((stats.matches / stats.attempts) * 100)
    : 0;

  const totalEvents = progress.total;
  const currentIdxDisplay = Math.min(progress.index + 1, totalEvents);

  const handleStart = useCallback(() => {
    start();
  }, [start]);

  const handleStop = useCallback(() => {
    stop();
  }, [stop]);

  const handleReset = useCallback(() => {
    resetSession();
    stop();
  }, [resetSession, stop]);

  const targetLabel = currentEvent?.label ?? DEFAULT_EXPECTED.name ?? "Target";

  return (
    <main className="practice-root">
      <section className="panel">
        <div className="header">
          <p className="eyebrow">Raziel MVP</p>
          <h1>{songTitle}</h1>
          {tempo ? <p className="meta">Tempo: {tempo} BPM</p> : null}
        </div>

        <div className="current-target">
          <p className="eyebrow">Current Target</p>
          <h2>{targetLabel}</h2>
          <p className="target-notes">Notes: {currentTargetText}</p>
          {currentEvent ? (
            <p className="meta">
              Measure {currentEvent.measureNumber} · Starts at beat {currentEvent.startBeat.toFixed(2)}
            </p>
          ) : null}
        </div>

        <div className="stats-grid">
          <div>
            <p className="eyebrow">Progress</p>
            <strong>
              {currentIdxDisplay}/{totalEvents || "-"}
            </strong>
          </div>
          <div>
            <p className="eyebrow">Accuracy</p>
            <strong>{accuracy}%</strong>
            <span className="meta">{stats.matches}/{stats.attempts || 1} matches</span>
          </div>
          <div>
            <p className="eyebrow">Detector</p>
            <strong>{detectorStatus}</strong>
            {errorMessage && <span className="meta error">{errorMessage}</span>}
          </div>
          <div>
            <p className="eyebrow">Session</p>
            <strong>{isComplete ? "Complete" : "In progress"}</strong>
          </div>
        </div>

        <div className="controls">
          <button
            onClick={handleStart}
            disabled={detectorStatus !== "idle" || songState.status !== "ready"}
          >
            Start Listening
          </button>
          <button onClick={handleStop} disabled={detectorStatus === "idle"}>
            Stop
          </button>
          <button onClick={handleReset}>Reset Session</button>
        </div>

        <div className="log">
          <p className="eyebrow">Real-time feedback</p>
          <ul>
            {log.map((entry) => (
              <li key={entry.id} data-type={entry.type}>
                {entry.message}
              </li>
            ))}
            {log.length === 0 ? <li className="placeholder">Play to see feedback here.</li> : null}
          </ul>
        </div>
      </section>
    </main>
  );
}
