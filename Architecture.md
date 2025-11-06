# Raziel - Technical Architecture & Implementation Plan

This document outlines the system architecture, data models, API design, and development roadmap for the Raziel guitar learning application.

**📋 For implementation details, see [TechnicalSpec.md](./TechnicalSpec.md)** - contains code-level details, algorithms, and step-by-step instructions for building the MVP.

---

# System Architecture

## High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         Client Layer                            │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │              React Web Application (PWA)                 │  │
│  │  ┌────────────┐  ┌──────────────┐  ┌─────────────────┐  │  │
│  │  │ UI Layer   │  │ Audio Engine │  │  State Manager  │  │  │
│  │  │ (React)    │  │ (Web Audio)  │  │  (Redux/Zustand)│  │  │
│  │  └────────────┘  └──────────────┘  └─────────────────┘  │  │
│  └──────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                              ↕ HTTP/WebSocket
┌─────────────────────────────────────────────────────────────────┐
│                         API Layer                               │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │              Node.js / Express Server                    │  │
│  │  ┌────────────┐  ┌──────────────┐  ┌─────────────────┐  │  │
│  │  │ REST API   │  │ WebSocket    │  │  Auth Service   │  │  │
│  │  │ Endpoints  │  │ (real-time)  │  │  (JWT)          │  │  │
│  │  └────────────┘  └──────────────┘  └─────────────────┘  │  │
│  └──────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                              ↕
┌─────────────────────────────────────────────────────────────────┐
│                      Data Layer                                 │
│  ┌──────────────┐  ┌──────────────┐  ┌─────────────────────┐  │
│  │ PostgreSQL   │  │ Redis Cache  │  │  File Storage       │  │
│  │ (User/Songs) │  │ (Sessions)   │  │  (MusicXML/Videos)  │  │
│  └──────────────┘  └──────────────┘  └─────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

## Component Breakdown

### Frontend Components

#### 1. UI Layer (React)
**Responsibilities:**
- Render all user interface screens
- Handle user interactions and navigation
- Display notation (tabs/staff) using VexFlow
- Show real-time feedback and visualizations

**Key Components:**
- `SongLibrary` - Browse and search songs
- `PracticeScreen` - Main practice interface
- `NotationDisplay` - Render tabs/notes with VexFlow
- `FeedbackBar` - Real-time performance feedback
- `SessionSummary` - Post-practice statistics
- `Tuner` - Guitar tuning interface
- `Settings` - User preferences

#### 2. Audio Engine
**Responsibilities:**
- Capture microphone input via Web Audio API
- Perform real-time pitch detection
- Detect single notes and chords (polyphonic)
- Calculate timing and accuracy
- Provide audio feedback

**Key Modules:**
- `AudioCapture` - Microphone access and stream management
- `PitchDetector` - FFT-based frequency analysis
- `ChordRecognizer` - Polyphonic pitch detection and chord matching
- `TimingAnalyzer` - Compare played notes to expected timing
- `FeedbackGenerator` - Audio cues for correct/incorrect notes

**Technology:**
- Web Audio API for audio input/processing
- FFT (Fast Fourier Transform) for frequency analysis
- Autocorrelation for pitch detection
- Optional: TensorFlow.js for ML-enhanced detection

#### 3. State Management
**Responsibilities:**
- Manage application state (Redux or Zustand)
- Handle user session data
- Sync with backend API
- Cache song data locally

**State Slices:**
- `user` - User profile, settings, authentication
- `songs` - Song library, metadata, current song
- `practice` - Current practice session, mode, progress
- `audio` - Audio settings, calibration data
- `progress` - Historical performance data

### Backend Components

#### 1. REST API (Node.js/Express)
**Responsibilities:**
- Handle CRUD operations for songs and users
- Serve song data (MusicXML files)
- Store and retrieve practice session data
- Manage user authentication

**Main Endpoints:** (see API Design section below)

#### 2. Authentication Service
**Responsibilities:**
- User registration and login
- JWT token generation and validation
- Password hashing and security

**Technology:**
- JWT for stateless authentication
- bcrypt for password hashing
- Optional: OAuth for social login

#### 3. WebSocket Server (Optional for v2)
**Responsibilities:**
- Real-time features (future: live sessions, multiplayer)
- Push notifications for achievements

### Data Layer

#### 1. PostgreSQL Database
**Responsibilities:**
- Store user accounts and profiles
- Store song metadata and library
- Store practice session history
- Store user progress and achievements

#### 2. Redis Cache
**Responsibilities:**
- Cache active session data
- Cache frequently accessed songs
- Rate limiting for API requests

#### 3. File Storage
**Responsibilities:**
- Store MusicXML files
- Store video files (hand positions)
- Store audio previews

**Technology:**
- Local filesystem for MVP
- Future: AWS S3 or similar cloud storage

---

# Data Models & Database Schema

## Database Schema

### Users Table
```sql
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username VARCHAR(50) UNIQUE NOT NULL,
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  last_login TIMESTAMP,
  settings JSONB DEFAULT '{}', -- User preferences
  profile JSONB DEFAULT '{}'   -- Additional profile data
);
```

### Songs Table
```sql
CREATE TABLE songs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title VARCHAR(255) NOT NULL,
  artist VARCHAR(255),
  composer VARCHAR(255),
  difficulty_level VARCHAR(20) NOT NULL, -- 'beginner', 'easy', 'intermediate', 'advanced', 'expert'
  genre VARCHAR(50),
  duration_seconds INTEGER NOT NULL,
  bpm INTEGER,
  key_signature VARCHAR(10),
  time_signature VARCHAR(10),
  musicxml_file_path VARCHAR(500) NOT NULL,
  video_file_path VARCHAR(500),
  preview_audio_path VARCHAR(500),
  techniques TEXT[], -- Array of technique tags
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  is_public BOOLEAN DEFAULT true,
  uploaded_by UUID REFERENCES users(id),
  metadata JSONB DEFAULT '{}'
);
```

### Practice Sessions Table
```sql
CREATE TABLE practice_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  song_id UUID NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
  started_at TIMESTAMP NOT NULL DEFAULT NOW(),
  ended_at TIMESTAMP,
  duration_seconds INTEGER,
  overall_accuracy DECIMAL(5,2), -- Percentage 0.00-100.00
  timing_accuracy DECIMAL(5,2),
  notes_played INTEGER DEFAULT 0,
  notes_correct INTEGER DEFAULT 0,
  chords_played INTEGER DEFAULT 0,
  chords_correct INTEGER DEFAULT 0,
  mode_used VARCHAR(20), -- 'wait', 'play', or 'mixed'
  completed BOOLEAN DEFAULT false,
  session_data JSONB DEFAULT '{}' -- Detailed performance data
);
```

### Session Details Table (Optional - for fine-grained tracking)
```sql
CREATE TABLE session_details (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES practice_sessions(id) ON DELETE CASCADE,
  measure_number INTEGER NOT NULL,
  timestamp_ms INTEGER NOT NULL, -- Milliseconds into the song
  note_expected VARCHAR(10), -- e.g., 'E4', 'C-major'
  note_played VARCHAR(10),
  is_correct BOOLEAN NOT NULL,
  timing_offset_ms INTEGER -- How early/late the note was played
);
```

### User Progress Table
```sql
CREATE TABLE user_progress (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  song_id UUID NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
  mastery_level VARCHAR(20) DEFAULT 'beginner', -- 'beginner', 'intermediate', 'advanced', 'mastered'
  best_accuracy DECIMAL(5,2) DEFAULT 0.00,
  times_practiced INTEGER DEFAULT 0,
  total_practice_time_seconds INTEGER DEFAULT 0,
  last_practiced_at TIMESTAMP,
  first_practiced_at TIMESTAMP DEFAULT NOW(),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(user_id, song_id)
);
```

### Achievements Table
```sql
CREATE TABLE achievements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(100) NOT NULL,
  description TEXT,
  icon VARCHAR(255),
  requirement JSONB NOT NULL, -- Conditions to unlock
  created_at TIMESTAMP DEFAULT NOW()
);
```

### User Achievements Table
```sql
CREATE TABLE user_achievements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  achievement_id UUID NOT NULL REFERENCES achievements(id) ON DELETE CASCADE,
  unlocked_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(user_id, achievement_id)
);
```

### Indexes
```sql
-- Performance indexes
CREATE INDEX idx_practice_sessions_user ON practice_sessions(user_id);
CREATE INDEX idx_practice_sessions_song ON practice_sessions(song_id);
CREATE INDEX idx_practice_sessions_date ON practice_sessions(started_at);
CREATE INDEX idx_user_progress_user ON user_progress(user_id);
CREATE INDEX idx_songs_difficulty ON songs(difficulty_level);
CREATE INDEX idx_songs_genre ON songs(genre);
```

## Frontend Data Models (TypeScript)

### Song Model
```typescript
interface Song {
  id: string;
  title: string;
  artist: string;
  composer?: string;
  difficultyLevel: 'beginner' | 'easy' | 'intermediate' | 'advanced' | 'expert';
  genre: string;
  durationSeconds: number;
  bpm: number;
  keySignature: string;
  timeSignature: string;
  techniques: string[];
  previewAudioUrl?: string;
  videoUrl?: string;
  metadata: Record<string, any>;
}
```

### Practice Session Model
```typescript
interface PracticeSession {
  id: string;
  songId: string;
  startedAt: Date;
  endedAt?: Date;
  durationSeconds: number;
  overallAccuracy: number;
  timingAccuracy: number;
  notesPlayed: number;
  notesCorrect: number;
  chordsPlayed: number;
  chordsCorrect: number;
  modeUsed: 'wait' | 'play' | 'mixed';
  completed: boolean;
  sessionData: {
    measureAccuracy: { measure: number; accuracy: number }[];
    problemSections: number[]; // Array of measure numbers
  };
}
```

### User Progress Model
```typescript
interface UserProgress {
  songId: string;
  masteryLevel: 'beginner' | 'intermediate' | 'advanced' | 'mastered';
  bestAccuracy: number;
  timesPracticed: number;
  totalPracticeTimeSeconds: number;
  lastPracticedAt: Date;
}
```

### Audio Detection Result
```typescript
interface DetectionResult {
  timestamp: number;
  detectedNotes: string[]; // Array of note names, e.g., ['E4', 'G4', 'B4']
  expectedNotes: string[];
  isCorrect: boolean;
  partialMatch?: boolean; // For chords
  correctNotes?: string[]; // Which notes in the chord were correct
  missingNotes?: string[]; // Which notes are missing
  timingOffsetMs: number; // Positive = late, negative = early
}
```

---

# API Design

## REST API Endpoints

### Authentication
```
POST   /api/auth/register
POST   /api/auth/login
POST   /api/auth/logout
GET    /api/auth/me
PUT    /api/auth/update-profile
```

### Songs
```
GET    /api/songs                    # List all songs (with filters)
GET    /api/songs/:id                # Get song details
GET    /api/songs/:id/musicxml       # Download MusicXML file
GET    /api/songs/:id/preview        # Get preview audio
POST   /api/songs                    # Upload new song (authenticated)
PUT    /api/songs/:id                # Update song metadata
DELETE /api/songs/:id                # Delete song
```

### Practice Sessions
```
POST   /api/sessions                 # Start new practice session
PUT    /api/sessions/:id             # Update session (progress, end)
GET    /api/sessions/:id             # Get session details
GET    /api/sessions/user/:userId    # Get user's session history
DELETE /api/sessions/:id             # Delete session
```

### User Progress
```
GET    /api/progress/user/:userId    # Get all progress for user
GET    /api/progress/song/:songId    # Get user's progress for specific song
PUT    /api/progress                 # Update progress after session
GET    /api/progress/stats           # Get aggregate statistics
```

### Achievements
```
GET    /api/achievements             # List all achievements
GET    /api/achievements/user/:userId # Get user's unlocked achievements
```

## API Request/Response Examples

### POST /api/auth/register
**Request:**
```json
{
  "username": "guitarplayer123",
  "email": "player@example.com",
  "password": "securePassword123"
}
```

**Response:**
```json
{
  "success": true,
  "user": {
    "id": "uuid-here",
    "username": "guitarplayer123",
    "email": "player@example.com"
  },
  "token": "jwt-token-here"
}
```

### GET /api/songs?difficulty=beginner&genre=rock
**Response:**
```json
{
  "songs": [
    {
      "id": "uuid-here",
      "title": "Smoke on the Water",
      "artist": "Deep Purple",
      "difficultyLevel": "beginner",
      "genre": "rock",
      "durationSeconds": 240,
      "bpm": 112,
      "techniques": ["power-chords", "riffs"],
      "previewAudioUrl": "/api/songs/uuid/preview"
    }
  ],
  "total": 1,
  "page": 1,
  "pageSize": 20
}
```

### POST /api/sessions
**Request:**
```json
{
  "songId": "uuid-here",
  "mode": "wait"
}
```

**Response:**
```json
{
  "sessionId": "uuid-here",
  "startedAt": "2025-11-05T10:00:00Z",
  "song": {
    "id": "uuid-here",
    "title": "Smoke on the Water"
  }
}
```

### PUT /api/sessions/:id (End Session)
**Request:**
```json
{
  "endedAt": "2025-11-05T10:15:00Z",
  "overallAccuracy": 87.5,
  "timingAccuracy": 82.3,
  "notesPlayed": 150,
  "notesCorrect": 131,
  "chordsPlayed": 20,
  "chordsCorrect": 18,
  "completed": true,
  "sessionData": {
    "measureAccuracy": [
      { "measure": 1, "accuracy": 95.0 },
      { "measure": 2, "accuracy": 80.0 }
    ],
    "problemSections": [5, 8, 12]
  }
}
```

**Response:**
```json
{
  "success": true,
  "session": {
    "id": "uuid-here",
    "overallAccuracy": 87.5,
    "completed": true
  },
  "progressUpdated": true,
  "achievementsUnlocked": [
    {
      "id": "achievement-uuid",
      "name": "First Song Completed",
      "description": "Complete your first practice session"
    }
  ]
}
```

---

# Development Roadmap

## Phase 1: MVP (Minimum Viable Product)

**Goal:** Prove core concept - detect guitar notes and provide feedback

**Timeline:** 3-4 weeks

### Features (True Minimum)
- **ONE hardcoded song** (Song of Storms) - no song library UI
- **Both single notes AND chords detection** using chromagram (Meyda)
- **Tab view only** (no staff notation)
- **Wait mode only** (no Play/tempo mode)
- **Visual feedback** (green/red/yellow for correct/incorrect/partial chords)
- **Basic accuracy score** at end
- **No backend** - everything in browser
- **No user accounts** - single session only
- **No tuner component** - assume guitar is in tune
- **No persistence** - refresh loses progress

### Technical Deliverables

**Week 1: Audio Foundation with Chromagram**
- Initialize Vite + React + TypeScript project
- Install dependencies: `meyda`, `fast-xml-parser`, `vexflow`
- Implement `AudioEngine` class with Meyda integration
- Implement `ChordDetector` class (chromagram-based)
- Create simple UI with "Start" button
- **Deliverable:** Console.log shows detected pitch classes (e.g., "E, G, B")

**Week 2: MusicXML & Display**
- Implement `musicXmlParser` to parse Song of Storms
- Keep ALL notes including chords
- Group notes by time position
- Integrate VexFlow for tab rendering (with stacked chord notation)
- Display first measure with highlighted current note/chord
- **Deliverable:** Tabs render on screen with chords displayed

**Week 3: Chord Matching & Wait Mode**
- Implement `chordMatcher` (compare detected vs expected)
- Implement `WaitModeController` for note/chord progression
- Connect chord detector to wait mode controller
- Advance when correct note/chord detected
- Show partial feedback (yellow = some notes in chord correct)
- **Deliverable:** Play notes/chords, see tabs advance with color-coded feedback

**Week 4: Complete MVP**
- Build session summary screen (show accuracy %)
- Add restart button
- Basic styling (center content, readable)
- Manual testing with real guitar
- Tune CHROMA_THRESHOLD based on testing
- **Deliverable:** Working end-to-end flow

### Success Criteria
- Can load and display Song of Storms tabs (including chords)
- Can detect single notes (E2, A2, D3, etc.)
- Can detect chords (E minor = E + G + B)
- Tabs advance in Wait mode when correct note/chord played
- Shows partial feedback for chords ("2 out of 3 notes correct")
- Shows final accuracy score
- Works in Chrome/Firefox on desktop
- **Total of ~300-400 lines of actual application code**

### Explicitly Out of Scope
- Multiple songs or song selection
- Song library UI
- User authentication
- Backend/database/API
- Play mode (tempo-based)
- Staff notation
- Tuner
- Progress persistence
- Session history
- Achievements
- Speed control
- Section looping
- Mobile optimization

## Phase 2: Enhanced Features

**Goal:** Add essential features for a complete learning experience

**Timeline:** 6-8 weeks

### Features
- **Play mode** (tempo-based practice with metronome)
- **Mode switching** during practice (toggle Wait ↔ Play)
- **Staff notation view** (in addition to tabs)
- **Speed adjustment** (slow down songs 50%-150%)
- **Section looping** (repeat difficult measures)
- **User accounts** (backend + auth)
- **Cloud storage** for progress
- **Multiple songs** (20-30 songs in library)
- **Song library UI** (browse, search, filter)

### Technical Deliverables
1. **Week 1-2: Backend Development**
   - Set up Node.js/Express server
   - Implement PostgreSQL database
   - Create REST API endpoints
   - Add JWT authentication

2. **Week 3-4: Play Mode & Advanced Controls**
   - Implement Play mode with tempo tracking
   - Add metronome click track
   - Add mode toggle functionality
   - Create speed adjustment slider
   - Implement section looping

3. **Week 5-6: Song Library**
   - Add 20-30 more MusicXML files
   - Build song library UI (grid view)
   - Add search and filtering
   - Integrate staff notation view (VexFlow)

4. **Week 7-8: User System & Cloud Sync**
   - Build registration/login UI
   - Integrate frontend with backend API
   - Implement progress syncing
   - Add session history view

### Success Criteria
- Seamless switching between Wait and Play modes
- User accounts with persistent progress tracking
- Can browse and select from 30+ songs
- 95%+ uptime for backend services
- Improved chord detection accuracy (tune from Phase 1 feedback)

## Phase 3: Learning Enhancements

**Goal:** Add features that accelerate learning and engagement

**Timeline:** 6-8 weeks

### Features
- **Video tutorials** for songs
- **Problem section practice**
- **Progress charts and analytics**
- **Achievement system**
- **Daily practice goals**
- **Song recommendations**
- **Mobile responsiveness** (PWA optimization)
- **Offline mode** for downloaded songs

### Technical Deliverables
1. Video player integration
2. Analytics dashboard
3. Achievement trigger system
4. Recommendation algorithm (basic)
5. Service worker for offline capability
6. Mobile UI optimization

## Phase 4: Advanced Features & Scaling

**Goal:** Expand capabilities and prepare for larger user base

**Timeline:** 8-10 weeks

### Features
- **Community features** (share songs, leaderboards)
- **Multi-track support** (lead/rhythm/bass)
- **Backing tracks**
- **MIDI input support**
- **Advanced analytics** with ML insights
- **Teacher/student mode**
- **Multiple instrument support** (bass, ukulele)

### Technical Deliverables
1. WebSocket server for real-time features
2. MIDI integration
3. Multi-track audio system
4. ML model training for playing style analysis
5. Social features backend
6. Scalability improvements (CDN, load balancing)

## Post-Launch: Continuous Improvement

### Ongoing Tasks
- Expand song library (user contributions)
- Performance optimization based on user feedback
- Bug fixes and maintenance
- A/B testing for UX improvements
- Mobile app development (React Native)
- Integration with music publishers for licensed content

---

# Technology Stack Summary

## Frontend
- **Framework:** React 18+ with TypeScript
- **State Management:** Redux Toolkit or Zustand
- **Audio Processing:** Web Audio API
- **Music Notation:** VexFlow
- **Styling:** Tailwind CSS or Material-UI
- **Build Tool:** Vite
- **Testing:** Jest, React Testing Library
- **PWA:** Workbox for service workers

## Backend
- **Runtime:** Node.js 18+
- **Framework:** Express.js
- **Language:** TypeScript
- **Authentication:** JWT, bcrypt
- **API Documentation:** Swagger/OpenAPI

## Database & Storage
- **Primary Database:** PostgreSQL 14+
- **Cache:** Redis
- **File Storage:** Local filesystem (MVP), S3 (future)
- **ORM:** Prisma or TypeORM

## DevOps & Infrastructure
- **Version Control:** Git + GitHub
- **CI/CD:** GitHub Actions
- **Hosting (MVP):**
  - Frontend: Vercel or Netlify
  - Backend: Railway, Render, or DigitalOcean
  - Database: Managed PostgreSQL (Supabase, Neon, or provider's managed service)
- **Monitoring:** Sentry (error tracking), LogRocket (session replay)

## Development Tools
- **Code Editor:** VS Code
- **API Testing:** Postman or Insomnia
- **Database Management:** pgAdmin or DBeaver
- **Package Manager:** npm or pnpm

---

# Next Steps

1. **Environment Setup**
   - Install Node.js, PostgreSQL, Redis
   - Set up development environment
   - Initialize Git repository

2. **Project Initialization**
   - Create React app with TypeScript
   - Set up Express backend
   - Configure database

3. **Start with Phase 1, Week 1**
   - Begin audio foundation work
   - Create basic pitch detection prototype

4. **Set up Project Management**
   - Create GitHub repository
   - Set up project board for task tracking
   - Define sprint schedule
