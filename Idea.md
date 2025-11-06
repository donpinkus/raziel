# IDEA

This is an overview of the Raziel project.

# Vision

I can play the guitar beautifully. This tool will help me learn guitar.

# Audience

I am a beginner guitar player, I can read tabs and music. I've been playing guitar for a few months and know the very basics.

# Features

Select from a song library. I can play along to the song, and the app will detect which notes and chords I'm playing correctly. There are two modes that can be switched at any time during the song:

1. Wait (default) - this mode waits for you to play the correct note or chord. It tracks where you are in the song and only advances when you play correctly.
2. Play - this mode plays the song according to its tempo. When a note or chord is played correctly within a tolerance window of the actual note - it is correct, otherwise it is incorrect.

You can toggle between Wait and Play modes at any point during practice to adjust your learning pace.

# View modes

1. Tabs - this is the guitar tab view
2. Notes - this is the staff view for conventional music
3. Video - if available, a video plays along and shows you the hand position.

# User Experience (UX)

## Main Interface Layout

### Practice Screen (Primary View)
The main practice screen is divided into key areas:

**Top Bar (Always Visible)**
- Song title and artist
- Progress indicator (current measure / total measures)
- Current tempo/BPM display
- Mode toggle button (Wait ↔ Play) - prominent, single-click to switch
- Settings icon (quick access to preferences)

**Center Area (Main Focus)**
- **Notation Display**: Large, scrolling view of tabs or staff notation
  - Current note/chord highlighted with distinct color
  - Upcoming notes visible (2-4 measures ahead)
  - Auto-scroll in Play mode, manual advance in Wait mode
  - Zoom controls for adjusting notation size
- **Video Overlay** (when available): Picture-in-picture or split-screen showing hand position

**Bottom Section (Feedback Zone)**
- **Real-time feedback bar**:
  - Visual indicator for current note detection (shows what you're playing)
  - Color-coded feedback: Green (correct), Red (incorrect), Yellow (partially correct for chords)
  - Accuracy meter with percentage
  - Streak counter
- **Audio waveform visualization**: Shows input signal strength
- **Playback controls**:
  - Pause/Resume button
  - Restart song button
  - Section loop markers (drag to select)

**Side Panel (Collapsible)**
- Song information and metadata
- View mode switcher (Tabs/Notes/Video)
- Speed adjustment slider (50%-150%)
- Quick access to song sections/bookmarks

## Key User Flows

### Starting a Practice Session
1. **Song Library Screen** → Browse or search for a song
2. Select song → **Song Preview Screen** (shows difficulty, length, preview audio)
3. Click "Start Practice" → **Calibration Check** (quick tuning verification if needed)
4. Enter **Practice Screen** in Wait mode by default
5. Begin playing

### During Practice
- **Switching modes**: Click mode toggle button at any time (Wait ↔ Play)
- **Adjusting speed**: Use speed slider to slow down difficult sections
- **Looping sections**: Click and drag to mark start/end points, enable loop
- **Changing view**: Click view tabs to switch between Tabs/Notes/Video
- **Pausing**: Click pause button; notation freezes, can review current position

### Completing a Session
1. Finish song or click "End Practice"
2. **Session Summary Screen** appears automatically
   - Shows accuracy, timing stats, problem areas
   - Option to retry immediately or save progress
3. Click "Continue" → Returns to **Song Library Screen**

## Screen Layouts

### Song Library Screen
- **Search bar** at top
- **Filter controls**: Difficulty, Genre, Duration
- **Grid or list view** of songs with thumbnails
- Each song card shows:
  - Title, artist
  - Difficulty badge
  - Duration
  - Your best score (if previously played)
  - Preview button (plays audio snippet)

### Session Summary Screen
- **Large accuracy score** prominently displayed (e.g., "87%")
- **Performance chart**: Visual representation of accuracy over time
- **Problem sections** highlighted with notation snippets
- **Improvement indicator**: Compare to previous attempts
- **Action buttons**:
  - "Try Again"
  - "Practice Problem Sections"
  - "Next Song Recommendation"
  - "Return to Library"

### Settings/Preferences Screen
- **Audio Settings**: Input selection, sensitivity, latency compensation
- **Display Settings**: Theme, notation size, colorblind mode
- **Practice Settings**: Default mode (Wait/Play), tolerance windows
- **Profile & Progress**: View stats, manage account

## Interactive Elements

### Mode Toggle Button
- **Visual Design**: Toggle switch or pill button
- **Current mode clearly indicated**: "WAIT" or "PLAY" with icon
- **Smooth transition**: Brief animation when switching
- **Keyboard shortcut**: Spacebar or designated key

### Note/Chord Feedback
- **Real-time highlighting**: As you play, notes light up on the notation
- **Chord partial feedback**: If playing a G chord but missing one note, show which notes are correct/missing
- **Audio cues**: Optional sounds for correct notes, errors
- **Haptic feedback**: Subtle vibration on mobile for correct notes

### Tuner Interface (Accessible Anytime)
- **Quick access**: Swipe from edge or click tuner icon
- **Visual tuner**: Needle or LED-style indicator
- **Per-string tuning**: Select which string to tune
- **Auto-detect**: Automatically identifies which string you're playing

## Visual Design Principles

- **Clean, distraction-free interface**: Focus on the notation and feedback
- **High contrast**: Ensure notation is easily readable
- **Responsive design**: Adapts to different screen sizes (desktop, tablet, mobile)
- **Dark mode support**: Reduce eye strain during long practice sessions
- **Accessibility**: Support for screen readers, keyboard navigation, adjustable font sizes

## Onboarding Flow

### First-Time User Experience
1. **Welcome Screen**: Brief app overview with key features
2. **Audio Setup**: Microphone permission, input test
3. **Interactive Tuner**: Tune guitar with guided instructions
4. **Quick Tutorial**: Interactive walkthrough of practice screen
   - "This is where you'll see the notes"
   - "Toggle here to switch modes"
   - "Watch your accuracy here"
5. **First Song Recommendation**: Suggest an easy beginner song
6. **Enter Practice Screen** with helpful tooltips

### Returning User Experience
- Skip directly to **Song Library Screen**
- Optional: "Quick tune-up?" prompt if last session was >1 day ago
- Show practice stats: "Welcome back! You're on a 5-day streak!"

# Technical details

## Song Storage

- Songs are stored in the **MusicXML format**
- MusicXML provides standard notation, tabs, tempo, and time signatures
- Can be exported from popular notation software (MuseScore, Finale, etc.)

## Platform

- **Primary target**: Web application (cross-platform compatibility)
- **Secondary target**: Mobile app (iOS/Android) for portability
- Progressive Web App (PWA) approach for offline capability

## Audio Processing

- **Input method**: Browser microphone access (Web Audio API) or audio interface
- **Note detection**: Real-time pitch detection using:
  - FFT (Fast Fourier Transform) for frequency analysis
  - Autocorrelation for fundamental frequency detection
  - Potential ML enhancement for better accuracy with guitar-specific timbres
- **Chord detection**: Recognize and validate full chords by detecting multiple simultaneous pitches
  - Polyphonic pitch detection for identifying individual notes within a chord
  - Chord matching algorithm to validate against expected chord shapes
  - Support for common chord types (major, minor, 7th, etc.)
- **Latency target**: < 50ms for responsive feedback
- **Tuning reference**: Standard tuning (E-A-D-G-B-E) with support for alternate tunings

## Tech Stack Considerations

- **Frontend**: React or React Native for UI
- **Audio processing**: Web Audio API, TensorFlow.js (for ML models)
- **Music notation rendering**: VexFlow or similar library for displaying tabs/notation
- **Backend**: Node.js for song library management and user data storage
- **Database**: PostgreSQL or Firebase for user progress and song metadata

## Note & Chord Matching Algorithm

- Time window tolerance for "Play" mode (e.g., ±100ms)
- Pitch tolerance for detecting correct notes and chords (accounting for slight tuning variations)
- Chord validation: all required notes must be present within the time window
- Real-time scoring algorithm based on accuracy and timing
- Partial chord recognition: feedback when some (but not all) notes in a chord are correct

# User Feedback & Progress Tracking

## Real-Time Feedback

- **Visual indicators**: Notes light up green (correct) or red (incorrect) as you play
- **Accuracy meter**: Live percentage showing current session accuracy
- **Streak counter**: Track consecutive correct notes to encourage consistency

## Song Summary

After completing a song:

- **Overall accuracy percentage**
- **Timing accuracy** (how close to the beat)
- **Problem areas**: Highlight measures or sections that need more practice
- **Time spent practicing**

## Long-Term Progress

- **Daily/weekly practice statistics** with charts
- **Song mastery levels**: Beginner, Intermediate, Advanced, Mastered
- **Practice streaks**: Days in a row practicing
- **Skill progression**: Track improvement on specific songs over time
- **Goals and achievements**: Milestones (e.g., "10 songs completed", "7-day streak")

## Replay & Review

- Replay your performance with visual playback showing where mistakes occurred
- Compare current performance to previous attempts

# Song Library

## Content Sources

- **Curated library**: Start with public domain songs and traditional pieces
- **Community contributions**: Users can share songs (with proper licensing)
- **Integration with notation software**: Import from MuseScore, Guitar Pro, etc.

## Song Organization

- **Difficulty levels**: Beginner, Easy, Intermediate, Advanced, Expert
- **Genres**: Rock, Blues, Classical, Folk, Pop, Jazz, etc.
- **Skills practiced**: Specific techniques (fingerpicking, strumming, barre chords, etc.)
- **Song length**: Filter by duration for quick practice sessions
- **Search & filters**: Find songs by artist, title, difficulty, genre

## Song Metadata

Each song includes:

- Title, artist, composer
- Difficulty rating
- Duration
- BPM (beats per minute)
- Key signature
- Techniques used
- Preview audio/video (if available)
- Community ratings and reviews

## Copyright Considerations

- Prioritize public domain and Creative Commons licensed content
- Clear attribution for all songs
- User responsibility disclaimer for uploaded content
- Potential partnerships with music publishers for licensed content (future)

# Onboarding & Calibration

## Initial Setup Wizard

1. **Welcome & Overview**: Brief introduction to the app's features
2. **Audio Input Setup**:
   - Select microphone or audio interface
   - Grant necessary permissions
   - Test audio levels with visual meter
3. **Tuning Verification**:
   - Interactive tuner to ensure guitar is in tune
   - String-by-string tuning guide
   - Visual and audio feedback for each string
4. **Preferences**:
   - Preferred view mode (tabs vs. notes)
   - Practice mode preference (Wait vs. Play)
   - Audio feedback settings

## Calibration Features

- **Re-tune anytime**: Access tuner from any screen
- **Audio sensitivity adjustment**: Configure for different environments (quiet room vs. noisy space)
- **Latency compensation**: Adjust timing tolerance based on system performance
- **Left-handed mode**: Flip tab/notation display for left-handed players

# Future Enhancements

## Advanced Features

- **Multi-track support**: Practice lead, rhythm, or bass parts separately
- **Backing tracks**: Play along with drums, bass, and other instruments
- **Speed adjustment**: Slow down songs to learn difficult passages, gradually increase tempo
- **Loop mode**: Repeat specific measures or sections until mastered
- **Recording studio**: Record and save your performances

## Technical Improvements

- **MIDI input**: Support for MIDI guitars and interfaces
- **Advanced analytics**: Machine learning insights into playing style and areas for improvement
- **Integration with DAWs**: Export practice sessions to recording software
- **Smart notifications**: Remind users to practice based on their schedule and goals
