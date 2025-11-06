# Raziel 🎸

A guitar learning app that listens as you play and helps you improve through real-time feedback using advanced polyphonic pitch detection.

**Repository:** https://github.com/donpinkus/raziel

---

## Vision

"I can play the guitar beautifully. This tool will help me learn guitar."

Raziel helps beginner guitarists who can read tabs and music learn songs through intelligent, real-time feedback. Whether you've been playing for a few months or years, Raziel adapts to your pace and shows you exactly what you're playing right or wrong.

---

## How It Works

### Core Features

**Practice Modes:**
1. **Wait Mode** (default) - Waits for you to play the correct note or chord before advancing. Perfect for learning new material at your own pace.
2. **Play Mode** - Plays along with the song's tempo. Notes must be played within a timing window to count as correct. Great for building speed and rhythm.

You can toggle between modes at any time during practice.

**Real-Time Feedback:**
- **Green** = Correct note/chord
- **Yellow** = Partial match (some notes in chord correct)
- **Red** = Incorrect or missing notes
- Visual display shows which specific notes are missing (e.g., "Missing: B")

**View Options:**
- Guitar tablature (MVP)
- Staff notation (Phase 2)
- Video tutorials showing hand positions (Phase 3)

---

## UX Highlights

### Practice Screen Layout

```
┌─────────────────────────────────────────────────────────┐
│ Top Bar: Song Title | Progress | BPM | Mode Toggle     │
├─────────────────────────────────────────────────────────┤
│                                                         │
│            Scrolling Guitar Tabs                        │
│       Current chord/note highlighted in color           │
│                                                         │
├─────────────────────────────────────────────────────────┤
│ Feedback: ●●●○○ 78% Accurate | Streak: 12              │
│ Detected: E, G, B ✓ | Missing: none                    │
└─────────────────────────────────────────────────────────┘
```

**User Flow:**
1. Browse song library → Select song
2. Click "Start Practice" → Microphone permission
3. Play guitar → See tabs advance with color-coded feedback
4. Complete song → View session summary (accuracy, problem areas)
5. Retry or choose next song

---

## MVP Scope (Phase 1 - 4 Weeks)

Building the absolute minimum to prove the concept:

### ✅ In MVP
- **ONE song** (Song of Storms from Zelda)
- **Single note AND chord detection** via Basic Pitch ML model
- **Guitar tab display** with chord notation
- **Wait mode** practice
- **Partial chord feedback** (yellow indicators)
- **Session summary** with accuracy stats
- **Browser-only** (no backend, no user accounts)

### ❌ Not in MVP
- Multiple songs / song library UI
- Play mode (tempo-based)
- Staff notation view
- User accounts / progress tracking
- Video tutorials
- Mobile app

---

## Tech Stack (MVP)

- **Frontend:** React 18 + TypeScript + Vite
- **Audio Pipeline:** Web Audio API → AudioWorklet → SharedArrayBuffer → Web Worker
- **Pitch Detection:** Spotify Basic Pitch model via ONNX Runtime Web (WebGPU/WebGL/WASM)
- **Music Notation:** VexFlow (guitar tabs)
- **Data Format:** MusicXML
- **State Management:** React Context
- **Chord Detection:** K-of-N policy engine on polyphonic transcription

**Key Innovation:** Streaming ML-based polyphonic transcription running entirely in the browser with <250ms latency.

---

## Documentation

### For Implementation
- **[TechnicalSpec.md](./TechnicalSpec.md)** ⭐ **START HERE FOR CODING**
  - Complete MVP implementation guide
  - Basic Pitch pipeline setup
  - Week-by-week development plan
  - Code examples and troubleshooting

### For System Design & Future Phases
- **[Architecture.md](./Architecture.md)**
  - Database schema
  - REST API design
  - Phase 2-4 roadmap (backend, song library, analytics)

---

## Quick Start

### Prerequisites
- Node.js 18+
- Chrome or Firefox (for Web Audio API + SharedArrayBuffer)
- A guitar 🎸

### Setup

```bash
cd ~/Desktop/raziel

# Create Vite project
npm create vite@latest . -- --template react-ts

# Install dependencies
npm install
npm install fast-xml-parser vexflow @spotify/basic-pitch onnxruntime-web tonal

# Prepare song file
mkdir -p public/songs
# (Song of Storms MusicXML file is already in the repo)

# Start dev server
npm run dev
# Open http://localhost:5173
```

**Important:** You'll need to configure COOP/COEP headers for SharedArrayBuffer support (see TechnicalSpec.md Week 1).

---

## Development Phases

### Phase 1: MVP (4 weeks) ← **WE ARE HERE**
✅ Prove core concept - Basic Pitch chord detection works in browser

### Phase 2: Enhanced Features (6-8 weeks)
🔜 Play mode, multiple songs, user accounts, backend

### Phase 3: Learning Features (6-8 weeks)
🔜 Videos, analytics, achievements, mobile PWA

### Phase 4: Advanced Features (8-10 weeks)
🔜 Community, multi-track, MIDI, ML insights

---

## Project Structure

```
raziel/
├── README.md                           ← You are here
├── TechnicalSpec.md                    ← Implementation guide
├── Architecture.md                     ← System design
├── public/
│   └── songs/
│       └── song-of-storms.musicxml
└── src/
    ├── audio/
    │   ├── worklets/                   ← AudioWorklet processors
    │   └── ringBuffer.ts               ← SharedArrayBuffer utils
    ├── workers/
    │   └── basicPitchWorker.ts         ← ML inference + policy engine
    ├── hooks/
    │   └── useChordVerifier.ts         ← React integration
    ├── components/                     ← UI components
    ├── services/                       ← Business logic
    └── utils/                          ← Helpers
```

---

## Key Implementation Files (Week 1 Focus)

1. `src/audio/worklets/inputProcessor.ts` - Capture audio to SharedArrayBuffer
2. `src/workers/basicPitchWorker.ts` - Basic Pitch inference + chord policies
3. `src/hooks/useChordVerifier.ts` - React hook for detection events
4. `src/services/musicXmlParser.ts` - Parse Song of Storms
5. `src/components/NotationDisplay.tsx` - VexFlow tabs
6. `src/services/waitModeController.ts` - Practice progression logic

---

## Contributing

Currently in MVP development. Not accepting contributions yet, but feel free to:
- Open issues for bugs or suggestions
- Star the repo if interested
- Follow for updates

---

## License

TBD

---

## Next Steps

**Ready to build?**

→ Open [TechnicalSpec.md](./TechnicalSpec.md) and follow Week 1: Audio Foundation with Basic Pitch

The technical spec includes complete scaffolding code, configuration examples, and troubleshooting guides.

---

**Built with Claude Code** 🤖
