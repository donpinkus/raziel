import { useEffect, useMemo, useRef } from "react";
import {
  Formatter,
  Renderer,
  TabNote as VFTabNote,
  TabStave,
  Voice,
} from "vexflow";
import type { Song, SongEvent, TabNote as SongTabNote } from "../types/song";

const DEFAULT_WIDTH = 900;
const DEFAULT_HEIGHT = 200;
const STRING_OPEN_MIDI: Record<number, number> = {
  1: 64, // E4
  2: 59, // B3
  3: 55, // G3
  4: 50, // D3
  5: 45, // A2
  6: 40, // E2
};

const DURATION_MAP: Record<number, string> = {
  4: "w",
  2: "h",
  1: "q",
  0.5: "8",
  0.25: "16",
};

export type NotationDisplayProps = {
  song: Song;
  currentIndex: number;
  windowSize?: number;
};

export default function NotationDisplay({
  song,
  currentIndex,
  windowSize = 8,
}: NotationDisplayProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);

  const eventsToRender = useMemo(() => {
    const start = Math.max(0, currentIndex - Math.floor(windowSize / 2));
    const slice = song.events.slice(start, start + windowSize);
    return { slice, offset: start };
  }, [song.events, currentIndex, windowSize]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    container.innerHTML = "";
    if (!eventsToRender.slice.length) return;

    const renderer = new Renderer(container, Renderer.Backends.SVG);
    renderer.resize(DEFAULT_WIDTH, DEFAULT_HEIGHT);
    const context = renderer.getContext();
    context.setFont("Inter", 12, "");
    context.setFillStyle("#e2e8ff");

    const tabStave = new TabStave(10, 20, DEFAULT_WIDTH - 20);
    tabStave.addTabGlyph();
    tabStave.setContext(context).draw();

    const tabNotes = eventsToRender.slice.map((event, idx) =>
      songEventToTabNote(event, eventsToRender.offset + idx === currentIndex)
    );

    const voice = new Voice({
      numBeats: song.timeSignature.beats,
      beatValue: song.timeSignature.beatType,
    });
    voice.setStrict(false);
    voice.addTickables(tabNotes);

    new Formatter().joinVoices([voice]).format([voice], DEFAULT_WIDTH - 80);
    voice.draw(context, tabStave);
  }, [eventsToRender, song.timeSignature, currentIndex]);

  return <div className="notation-display" ref={containerRef} aria-label="Guitar tablature" />;
}

function songEventToTabNote(event: SongEvent, isActive: boolean): VFTabNote {
  const positions = event.notes.map((n) => buildPosition(n));
  const duration = pickDuration(event.durationBeats);
  const tabNote = new VFTabNote(
    {
      positions,
      duration,
    },
    false
  );

  if (isActive) {
    tabNote.setStyle({ strokeStyle: "#00d2ff", fillStyle: "#00d2ff" });
  }

  return tabNote;
}

function buildPosition(note: SongTabNote): { str: number; fret: number } {
  const str = clampStringNumber(note.string);
  if (note.fret != null) {
    return { str, fret: note.fret };
  }
  const openMidi = STRING_OPEN_MIDI[str] ?? 40;
  const fret = Math.max(0, note.midi - openMidi);
  return { str, fret };
}

function clampStringNumber(value?: number): number {
  if (!value) return 1;
  return Math.min(6, Math.max(1, value));
}

function pickDuration(durationBeats: number): string {
  if (DURATION_MAP[durationBeats]) return DURATION_MAP[durationBeats];
  if (durationBeats >= 1.5 && durationBeats < 2) return "qd"; // dotted quarter
  if (durationBeats >= 0.75 && durationBeats < 1) return "8d";
  return "q";
}
