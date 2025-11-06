import { useMemo, useState } from "react";
import useChordVerifier from "./hooks/useChordVerifier";
import type { PitchClass, ResultEvent } from "./types/audio";
import "./App.css";

const PC_LABELS = [
  "C",
  "C#",
  "D",
  "D#",
  "E",
  "F",
  "F#",
  "G",
  "G#",
  "A",
  "A#",
  "B",
];

const pcsToName = (pc: PitchClass) => PC_LABELS[pc];

export default function App() {
  const [log, setLog] = useState<string[]>([]);
  const expected = useMemo(
    () => ({ name: "E minor", pcs: [4, 7, 11] as PitchClass[], K: 2 }),
    []
  );

  const { status, errorMessage, start, stop } = useChordVerifier({
    expected,
    onResult: (event: ResultEvent) => {
      if (event.type === "CHORD_MATCH") {
        setLog((prev) => [`✅ MATCH`, ...prev].slice(0, 12));
      } else if (event.type === "CHORD_MISS") {
        setLog((prev) =>
          [
            `miss (have: ${event.matched
              .map(pcsToName)
              .join(", ") || "-"}, need: ${event.missing
              .map(pcsToName)
              .join(", ")})`,
            ...prev,
          ].slice(0, 12)
        );
      } else if (event.type === "ERROR") {
        setLog((prev) => [`⚠️ ${event.message}`, ...prev].slice(0, 12));
      }
    },
  });

  return (
    <main className="app">
      <section className="panel">
        <h1>Raziel Pitch Detector</h1>
        <p>
          Status: <strong>{status}</strong>
        </p>
        {errorMessage ? <p className="error">{errorMessage}</p> : null}
        <div className="controls">
          <button onClick={start} disabled={status !== "idle"}>
            Start listening
          </button>
          <button onClick={stop} disabled={status === "idle"}>
            Stop
          </button>
        </div>
        <h2>Event log</h2>
        <ul className="log">
          {log.map((entry, idx) => (
            <li key={idx}>{entry}</li>
          ))}
        </ul>
      </section>
    </main>
  );
}
