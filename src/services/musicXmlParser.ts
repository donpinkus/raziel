import type { ChordSpec, PitchClass } from "../types/audio";
import type { Song, SongEvent, TabNote } from "../types/song";

const STEP_TO_SEMITONE: Record<string, number> = {
  C: 0,
  D: 2,
  E: 4,
  F: 5,
  G: 7,
  A: 9,
  B: 11,
};

const DEFAULT_TIME = { beats: 4, beatType: 4 };

export async function loadSong(
  songPath = "/songs/song-of-storms.musicxml"
): Promise<Song> {
  const res = await fetch(songPath);
  if (!res.ok) {
    throw new Error(`Failed to load song: ${res.status}`);
  }
  const xml = await res.text();
  return parseSongXml(xml);
}

export function parseSongXml(xml: string): Song {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xml, "application/xml");
  if (doc.querySelector("parsererror")) {
    throw new Error("Invalid MusicXML document");
  }

  const title =
    doc.querySelector("movement-title")?.textContent?.trim() ??
    "Untitled Song";

  const part = doc.querySelector("score-partwise > part");
  if (!part) {
    throw new Error("MusicXML missing <part>");
  }

  const measures = Array.from(part.querySelectorAll("measure"));
  let divisions = 1;
  let tempo = 100;
  let timeSignature = { ...DEFAULT_TIME };
  const events: SongEvent[] = [];
  let totalBeats = 0;

  measures.forEach((measureNode, measureIdx) => {
    const numberAttr = measureNode.getAttribute("number");
    const measureNumber = numberAttr ? parseInt(numberAttr, 10) : measureIdx + 1;

    const attributes = measureNode.querySelector("attributes");
    const divisionsNode = attributes?.querySelector("divisions");
    if (divisionsNode) {
      const parsed = Number(divisionsNode.textContent ?? divisions);
      if (!Number.isNaN(parsed) && parsed > 0) divisions = parsed;
    }

    const beats = attributes?.querySelector("time > beats")?.textContent;
    const beatType =
      attributes?.querySelector("time > beat-type")?.textContent;
    if (beats && beatType) {
      const b = Number(beats);
      const bt = Number(beatType);
      if (!Number.isNaN(b) && !Number.isNaN(bt)) {
        timeSignature = { beats: b, beatType: bt };
      }
    }

    const tempoNode = measureNode.querySelector("direction sound[tempo]");
    if (tempoNode) {
      const tempoValue = tempoNode.getAttribute("tempo");
      if (tempoValue) {
        const parsed = Number(tempoValue);
        if (!Number.isNaN(parsed)) tempo = parsed;
      }
    }

    let beatCursor = 0;
    const noteNodes = Array.from(measureNode.querySelectorAll("note"));

    noteNodes.forEach((noteNode) => {
      const durationNode = noteNode.querySelector("duration");
      const durationDivs = Number(durationNode?.textContent ?? "0");
      const durationBeats = divisions ? durationDivs / divisions : 0;

      const isRest = noteNode.querySelector("rest") !== null;
      const isChord = noteNode.querySelector("chord") !== null;

      if (isRest) {
        beatCursor += durationBeats;
        return;
      }

      const tabNote = buildTabNote(noteNode);
      if (!tabNote) {
        if (!isChord) beatCursor += durationBeats;
        return;
      }

      if (isChord && events.length) {
        const current = events[events.length - 1];
        current.notes.push(tabNote);
        current.chordSpec = buildChordSpec(current.notes);
        current.label = buildLabel(current.notes);
      } else {
        const event: SongEvent = {
          id: `m${measureNumber}-n${events.length}`,
          measureNumber,
          startBeat: beatCursor,
          durationBeats,
          notes: [tabNote],
          chordSpec: buildChordSpec([tabNote]),
          label: buildLabel([tabNote]),
        };
        events.push(event);
        beatCursor += durationBeats;
      }
    });

    totalBeats += beatCursor;
  });

  return {
    title,
    tempo,
    timeSignature,
    events,
    totalBeats,
  };
}

function buildTabNote(noteNode: Element): TabNote | null {
  const pitchNode = noteNode.querySelector("pitch");
  if (!pitchNode) return null;
  const step = pitchNode.querySelector("step")?.textContent as keyof typeof STEP_TO_SEMITONE | undefined;
  const octave = Number(pitchNode.querySelector("octave")?.textContent ?? "0");
  const alter = Number(pitchNode.querySelector("alter")?.textContent ?? "0");
  if (!step) return null;

  const semitone = (STEP_TO_SEMITONE[step] ?? 0) + alter;
  const midi = (octave + 1) * 12 + semitone;
  const pitchClass = (((semitone % 12) + 12) % 12) as PitchClass;
  const accidental = alter === 1 ? "#" : alter === -1 ? "b" : "";
  const name = `${step}${accidental}${octave}`;

  const technical = noteNode.querySelector("notations technical");
  const stringVal = technical?.querySelector("string")?.textContent;
  const fretVal = technical?.querySelector("fret")?.textContent;

  return {
    midi,
    pitchClass,
    name,
    string: stringVal ? Number(stringVal) : undefined,
    fret: fretVal ? Number(fretVal) : undefined,
  };
}

function buildChordSpec(notes: TabNote[]): ChordSpec {
  const pcs = Array.from(new Set(notes.map((n) => n.pitchClass))).sort(
    (a, b) => a - b
  ) as PitchClass[];
  return {
    name: buildLabel(notes),
    pcs,
    K: Math.min(2, pcs.length) || 1,
  };
}

function buildLabel(notes: TabNote[]): string {
  return notes.map((n) => n.name).join(" · ");
}
