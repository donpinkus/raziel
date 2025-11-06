# Raziel 🎸

A guitar learning app that listens as you play and helps you improve through real-time feedback.

## Project Status

**Currently:** Planning phase complete, ready to start development

## 📚 Documentation

### Planning Documents

1. **[Idea.md](./Idea.md)** - Product vision and UX design
   - What the app does and why
   - Target audience
   - Features and user flows
   - Complete UX specifications

2. **[Architecture.md](./Architecture.md)** - System architecture and roadmap
   - High-level architecture (client, API, data layers)
   - Database schema and data models
   - REST API design
   - 4-phase development roadmap
   - Technology stack decisions

3. **[TechnicalSpec.md](./TechnicalSpec.md)** - Implementation guide ⭐ **START HERE FOR CODING**
   - MVP scope (what we're actually building first)
   - MusicXML parsing implementation
   - Pitch detection algorithm (autocorrelation)
   - Code examples and file structure
   - Environment setup instructions
   - Week-by-week development plan

### Reading Order

**If you're coding:** Read `TechnicalSpec.md` first, then reference `Architecture.md` as needed.

**If you're planning/designing:** Read `Idea.md` → `Architecture.md` → `TechnicalSpec.md`.

## MVP Scope (Phase 1)

Building the absolute minimum to prove the core concept:

✅ **In MVP:**
- ONE song (Song of Storms from Zelda)
- **Single note AND chord detection** (chromagram-based)
- Guitar tab display (with chord notation)
- Wait mode (waits for you to play correct note/chord)
- Partial chord feedback (yellow = some notes correct)
- Basic accuracy score
- Browser-only (no backend)

❌ **Not in MVP:**
- Multiple songs
- Play mode (tempo-based)
- User accounts
- Progress tracking
- Mobile app

**Timeline:** 4 weeks

## Tech Stack (MVP)

- **Frontend:** React 18 + TypeScript + Vite
- **Audio:** Web Audio API + Meyda (chromagram-based chord detection)
- **Music Notation:** VexFlow (tab rendering)
- **Data Format:** MusicXML
- **State:** React Context (no Redux yet)
- **Chord Detection:** Pitch Class Profile (industry-standard MIR approach)

## Getting Started

### Prerequisites

- Node.js 18+
- Chrome or Firefox (for Web Audio API)
- A guitar 🎸

### Setup

```bash
# Create Vite project
npm create vite@latest . -- --template react-ts

# Install dependencies
npm install
npm install fast-xml-parser vexflow meyda

# Move song file
mkdir -p public/songs
mv "Song of Storms - Legend of Zelda (Simple Guitar Tab).musicxml" public/songs/song-of-storms.musicxml

# Start dev server
npm run dev
```

See [TechnicalSpec.md](./TechnicalSpec.md) for detailed instructions.

## Development Phases

### Phase 1: MVP (4 weeks) ← **WE ARE HERE**
Prove core concept - detect notes AND chords, provide feedback

### Phase 2: Enhanced Features (6-8 weeks)
Add Play mode, song library, user accounts, backend

### Phase 3: Learning Features (6-8 weeks)
Add videos, analytics, achievements, mobile PWA

### Phase 4: Advanced Features (8-10 weeks)
Community features, multi-track, MIDI, ML

## Project Structure (Planned)

```
raziel/
├── README.md               ← You are here
├── Idea.md                 ← Product vision
├── Architecture.md         ← System design
├── TechnicalSpec.md        ← Implementation guide
├── public/
│   └── songs/
│       └── song-of-storms.musicxml
└── src/
    ├── components/         ← React components
    ├── services/           ← Core logic (audio, parsing, matching)
    ├── types/              ← TypeScript interfaces
    └── utils/              ← Helper functions
```

## Key Files to Create First

1. `src/services/audioEngine.ts` - Web Audio API + Meyda integration
2. `src/services/chordDetector.ts` - Chromagram to pitch classes
3. `src/services/musicXmlParser.ts` - Parse Song of Storms
4. `src/services/chordMatcher.ts` - Match detected vs expected
5. `src/components/PracticeScreen.tsx` - Main UI
6. `src/components/NotationDisplay.tsx` - VexFlow tabs

## Next Steps

1. ✅ Complete planning documents
2. ⏳ Initialize Vite project
3. ⏳ Implement audio engine
4. ⏳ Implement pitch detector
5. ⏳ Parse MusicXML
6. ⏳ Display tabs
7. ⏳ Implement note matching
8. ⏳ Build session summary
9. ⏳ Test and polish

## Vision

Help guitarists learn through intelligent, real-time feedback that adapts to their skill level. Make practice more engaging and effective.

## License

TBD

---

**Ready to code?** → Open [TechnicalSpec.md](./TechnicalSpec.md) and start with Week 1: Audio Foundation.
