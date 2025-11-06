import { useEffect, useRef, useState } from "react";
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

type RenderCtx = ReturnType<Renderer["getContext"]>;

// SVG viewport size for the rendered TAB staff
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

// Simple mapping from beat length (in MusicXML "beats") -> VexFlow duration
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
}: NotationDisplayProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const svgWrapperRef = useRef<HTMLDivElement | null>(null);
  const [activeX, setActiveX] = useState(0);
  const [trackWidth, setTrackWidth] = useState(DEFAULT_WIDTH);
  const anchorX = 120;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    container.innerHTML = "";
    if (!song.events.length) return;

    // Set up a fresh VexFlow SVG renderer every time the windowed slice changes.
    const renderer = new Renderer(container, Renderer.Backends.SVG);
    renderer.resize(DEFAULT_WIDTH, DEFAULT_HEIGHT);
    const context = renderer.getContext();
    context.setFillStyle("rgba(255,255,255,0.5)");
    context.setStrokeStyle(STAVE_COLOR);

    const STAVE_PADDING = 40;
    const tabStave = new TabStave(
      STAVE_PADDING,
      20,
      DEFAULT_WIDTH - 2 * STAVE_PADDING
    );
    tabStave.addTabGlyph();
    tabStave.setContext(context);
    tabStave.setStyle({ strokeStyle: STAVE_COLOR, fillStyle: STAVE_COLOR });
    tabStave.draw();

    // Convert each SongEvent into a VexFlow TabNote, flagging the active event.
    const tabNotes = song.events.map((event, idx) =>
      songEventToTabNote(event, idx === currentIndex)
    );

    const voice = new Voice({
      numBeats: song.timeSignature.beats,
      beatValue: song.timeSignature.beatType,
    });
    voice.setStrict(false);
    voice.addTickables(tabNotes);

    const formatWidth = Math.max(DEFAULT_WIDTH, tabNotes.length * 80);
    new Formatter().joinVoices([voice]).format([voice], formatWidth);
    voice.draw(context, tabStave);

    setTrackWidth(formatWidth + STAVE_PADDING * 2);

    const activeNote = tabNotes[currentIndex];
    if (activeNote) {
      setActiveX(activeNote.getAbsoluteX());
    }

    // Draw simple bar lines whenever the measure number changes.
    let lastMeasure = song.events[0]?.measureNumber;
    tabNotes.forEach((note, idx) => {
      const event = song.events[idx];
      if (event && event.measureNumber !== lastMeasure) {
        const barline = new Barline(BarlineType.SINGLE);
        barline.setStave(tabStave);
        barline.setX(note.getAbsoluteX() - 10);
        barline.draw();
        lastMeasure = event.measureNumber;
      }
    });
  }, [song.events, song.timeSignature, currentIndex]);

  const offset = Math.max(0, activeX - anchorX);

  return (
    <div className="notation-display" aria-label="Guitar tablature">
      <div className="notation-display__viewport">
        <div
          className="notation-display__track"
          ref={svgWrapperRef}
          style={{
            width: trackWidth,
            transform: `translateX(${-offset}px)`,
          }}
        >
          <div ref={containerRef} />
        </div>
        <div className="notation-display__anchor" style={{ left: anchorX }} />
      </div>
    </div>
  );
}

function songEventToTabNote(event: SongEvent, isActive: boolean): VFTabNote {
  const positions = event.notes.map((n) => buildPosition(n));
  const duration = pickDuration(event.durationBeats);
  const tabNote = new HighlightedTabNote(
    {
      positions,
      duration,
    },
    false,
    isActive
  );

  tabNote.setStyle({
    fillStyle: NOTE_COLOR,
    strokeStyle: NOTE_COLOR,
  });
  return tabNote;
}

class HighlightedTabNote extends VFTabNote {
  private readonly isActive: boolean;

  constructor(
    opts: ConstructorParameters<typeof VFTabNote>[0],
    isGhost: boolean,
    isActive: boolean
  ) {
    super(opts, isGhost);
    this.isActive = isActive;
  }

  draw(): this {
    const ctx = this.checkContext();
    const x = this.getAbsoluteX();
    const yCenter = this.getYs()[0] ?? 0;
    const width = 38;
    const height = 32;
    const y = yCenter - height / 2;

    ctx.save();
    ctx.setFillStyle(this.isActive ? ACTIVE_BG : INACTIVE_BG);
    drawRoundedRect(
      ctx,
      x - width / 2,
      y,
      width,
      height,
      6
    );
    ctx.restore();

    super.draw();
    return this;
  }
}

function drawRoundedRect(
  ctx: RenderCtx,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number
) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + width - radius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
  ctx.lineTo(x + width, y + height - radius);
  ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  ctx.lineTo(x + radius, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
  ctx.fill();
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
const ACTIVE_BG = "rgba(111, 245, 255, 0.25)";
const INACTIVE_BG = "rgba(255, 255, 255, 0.08)";
