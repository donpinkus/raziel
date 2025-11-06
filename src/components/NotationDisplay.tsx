import { useEffect, useMemo, useRef } from "react";
import {
  Barline,
  BarlineType,
  Formatter,
  Renderer,
  TabNote as VFTabNote,
  TabStave,
  Voice,
} from "vexflow";
import type { Song, SongEvent, TabNote as SongTabNote } from "../types/song";

const DEFAULT_WIDTH = 900;
const DEFAULT_HEIGHT = 220;
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
    if (import.meta.env.DEV && slice.length && start === 0) {
      // Helpful debug log to confirm positions once per load
      console.debug(
        "[NotationDisplay] First event positions",
        slice[0].notes.map((note) => ({
          name: note.name,
          inferred: inferStringAndFret(note.midi),
          originalString: note.string,
          originalFret: note.fret,
        }))
      );
    }
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
    context.setFont("JetBrains Mono", 16, "500");
    context.setFillStyle("#ffffff");
    context.setStrokeStyle(STAVE_COLOR);

    const STAVE_PADDING = 40;
    const tabStave = new TabStave(STAVE_PADDING, 20, DEFAULT_WIDTH - 2 * STAVE_PADDING);
    tabStave.addTabGlyph();
    tabStave.setContext(context);
    tabStave.setStyle({ strokeStyle: STAVE_COLOR, fillStyle: STAVE_COLOR });
    tabStave.draw();

    const tabNotes = eventsToRender.slice.map((event, idx) =>
      songEventToTabNote(event, eventsToRender.offset + idx === currentIndex)
    );

    const voice = new Voice({
      numBeats: song.timeSignature.beats,
      beatValue: song.timeSignature.beatType,
    });
    voice.setStrict(false);
    voice.addTickables(tabNotes);

    new Formatter().joinVoices([voice]).format([voice], DEFAULT_WIDTH - 2 * STAVE_PADDING - 40);
    voice.draw(context, tabStave);

    // Add bar lines between measures
    let lastMeasure = eventsToRender.slice[0]?.measureNumber;
    tabNotes.forEach((note, idx) => {
      const event = eventsToRender.slice[idx];
      if (event && event.measureNumber !== lastMeasure) {
        const barline = new Barline(BarlineType.SINGLE);
        barline.setStave(tabStave);
        barline.setX(note.getAbsoluteX() - 10);
        barline.draw();
        lastMeasure = event.measureNumber;
      }
    });
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

  tabNote.setStyle({
    fillStyle: isActive ? ACTIVE_COLOR : NOTE_COLOR,
    strokeStyle: isActive ? ACTIVE_COLOR : NOTE_COLOR,
  });
  return tabNote;
}

function buildPosition(note: SongTabNote): { str: number; fret: number } {
  const providedString = note.string;
  const providedFret = note.fret;
  if (providedString && providedFret != null) {
    return { str: clampStringNumber(providedString), fret: providedFret };
  }
  return inferStringAndFret(note.midi);
}

type PositionCandidate = { str: number; fret: number; delta: number };

function inferStringAndFret(midi: number): { str: number; fret: number } {
  const entries = Object.entries(STRING_OPEN_MIDI) as [string, number][];
  let best: PositionCandidate | undefined;
  entries.forEach(([strKey, openMidi]) => {
    const fret = midi - openMidi;
    if (fret < 0 || fret > 24) return;
    const delta = Math.abs(fret);
    if (!best || delta < best.delta) {
      best = { str: Number(strKey), fret, delta };
    }
  });
  if (best) {
    return { str: best.str, fret: best.fret };
  }
  const stringsByCloseness: PositionCandidate[] = entries
    .map(([strKey, openMidi]) => ({
      str: Number(strKey),
      fret: Math.max(0, midi - openMidi),
      delta: Math.abs(midi - openMidi),
    }))
    .sort((a, b) => a.delta - b.delta);
  const picked = stringsByCloseness[0];
  if (picked) {
    return { str: picked.str, fret: picked.fret };
  }
  return { str: 1, fret: 0 };
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
const STAVE_COLOR = "#a8b4e6";
const NOTE_COLOR = "#ffffff";
const ACTIVE_COLOR = "#6df3ff";
