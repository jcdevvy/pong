const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");

const PADDLE_WIDTH = 10;
const PADDLE_HEIGHT = 80;
const BALL_SIZE = 8;

// Fixed x-positions for the paddles (same values as server.js — paddles
// only ever move up/down, so x never changes).
const LEFT_X = 20;
const RIGHT_X = canvas.width - 20 - PADDLE_WIDTH;

// --- Pixel sprites (no image files — just grids of 0/1) ---
// Each row is one horizontal strip of pixels; a 1 means "draw a block here,"
// a 0 means "leave it transparent." drawSprite() below stretches this grid
// to fill whatever width/height you give it, so the same sprite works for
// both paddles without needing to match PADDLE_WIDTH/HEIGHT exactly.

// Longsword: straight, symmetric double-edged blade, straight crossguard.
// Read top-to-bottom: tapered tip, 8 rows of blade, crossguard, grip, pommel.
const longswordSprite = [
  [0, 0, 0, 0, 1, 0, 0, 0], // tip
  [0, 0, 0, 1, 1, 0, 0, 0],
  [0, 0, 0, 1, 1, 0, 0, 0],
  [0, 0, 0, 1, 1, 0, 0, 0],
  [0, 0, 0, 1, 1, 0, 0, 0],
  [0, 0, 0, 1, 1, 0, 0, 0],
  [0, 0, 0, 1, 1, 0, 0, 0],
  [0, 0, 0, 1, 1, 0, 0, 0],
  [0, 0, 0, 1, 1, 0, 0, 0], // blade end
  [0, 1, 1, 1, 1, 1, 1, 0], // crossguard — straight, symmetric
  [0, 0, 0, 1, 1, 0, 0, 0], // grip
  [0, 0, 0, 1, 1, 0, 0, 0],
  [0, 0, 0, 1, 1, 0, 0, 0],
  [0, 0, 1, 1, 1, 1, 0, 0], // pommel
  [0, 0, 1, 1, 1, 1, 0, 0],
  [0, 0, 0, 1, 1, 0, 0, 0],
];

// Saber: single-edged, blade offset to one side (thicker "spine" on the
// left of center instead of symmetric), with a swept, asymmetric guard —
// deliberately a different silhouette from the longsword so the two sides
// read as different fighters, not a mirrored copy.
const saberSprite = [
  [0, 0, 0, 0, 1, 0, 0, 0], // tip
  [0, 0, 0, 0, 1, 1, 0, 0],
  [0, 0, 0, 1, 1, 1, 0, 0],
  [0, 0, 0, 0, 1, 1, 0, 0],
  [0, 0, 0, 0, 1, 1, 0, 0],
  [0, 0, 0, 0, 1, 1, 0, 0],
  [0, 0, 0, 0, 1, 1, 0, 0],
  [0, 0, 0, 0, 1, 1, 0, 0],
  [0, 0, 0, 0, 1, 1, 0, 0], // blade end
  [0, 1, 1, 0, 1, 1, 1, 0], // swept guard — asymmetric, gap on one side
  [0, 0, 0, 0, 1, 1, 0, 0], // grip
  [0, 0, 0, 0, 1, 1, 0, 0],
  [0, 0, 0, 0, 1, 1, 0, 0],
  [0, 0, 0, 1, 1, 1, 0, 0], // pommel
  [0, 0, 0, 1, 1, 1, 0, 0],
  [0, 0, 0, 0, 1, 1, 0, 0],
];

// Spiked mace head: a rounded blob with small spikes poking out on each side.
const maceSprite = [
  [0, 0, 0, 1, 1, 0, 0, 0],
  [0, 0, 1, 1, 1, 1, 0, 0],
  [0, 1, 1, 1, 1, 1, 1, 0],
  [1, 1, 1, 1, 1, 1, 1, 1],
  [1, 1, 1, 1, 1, 1, 1, 1],
  [0, 1, 1, 1, 1, 1, 1, 0],
  [0, 0, 1, 1, 1, 1, 0, 0],
  [0, 0, 0, 1, 1, 0, 0, 0],
];

// Reads a sprite grid and draws one filled rectangle per "1" cell, scaled to
// fit exactly into (width x height) at position (x, y). Because it divides
// width/height by the grid's column/row count, the same sprite renders
// correctly no matter what size you ask for.
function drawSprite(sprite, x, y, width, height, color) {
  const rows = sprite.length;
  const cols = sprite[0].length;
  const pixelWidth = width / cols;
  const pixelHeight = height / rows;

  ctx.fillStyle = color;
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      if (sprite[row][col]) {
        ctx.fillRect(x + col * pixelWidth, y + row * pixelHeight, pixelWidth, pixelHeight);
      }
    }
  }
}

// Stores the ball's last few positions so we can draw a fading trail behind
// it. Pushed to at the end of every draw() call, capped at TRAIL_LENGTH.
const ballTrail = [];
const TRAIL_LENGTH = 6;

// --- Ghosthit ---
const GHOSTHIT_COST = 3; // must match server.js — only used here to color the points display
const GHOST_FADE_DISTANCE = canvas.width * 0.75; // mirrors fully fade after traveling this far
const GHOST_Y_OFFSETS = [-24, 0, 24]; // vertical spread between the 3 mirror images

// Active mirror balls: { x, y, dx, dy, spawnX }. Purely cosmetic and purely
// client-side — the server only tells us a Ghosthit happened and where the
// real ball was at that instant; everything about how the mirrors move and
// fade from there is decided here, since they never need to be hit or agreed
// on between the two browsers.
let ghostBalls = [];

// Spawns 3 mirror balls at the real ball's current position, each copying
// its direction so they initially fly alongside it, spread out vertically
// so they read as distinct "images" rather than one ball.
function spawnGhostBalls(ball) {
  ghostBalls = GHOST_Y_OFFSETS.map((offset) => ({
    x: ball.x,
    y: ball.y + offset,
    spawnX: ball.x,
  }));
}

// Moves each mirror by the REAL ball's current dx/dy (read fresh from
// latestState every frame, not a snapshot taken at spawn time) — that's what
// guarantees they always travel at exactly the same speed as the real ball,
// even if it later speeds up off a parry or flips direction off a wall
// bounce. They just don't clamp to the walls themselves the way the real
// ball does, which is fine since they fade out well before reaching one.
function updateGhostBalls() {
  ghostBalls.forEach((g) => {
    g.x += latestState.ball.dx;
    g.y += latestState.ball.dy;
  });
  ghostBalls = ghostBalls.filter((g) => Math.abs(g.x - g.spawnX) < GHOST_FADE_DISTANCE);
}

function drawGhostBalls() {
  ghostBalls.forEach((g) => {
    const traveled = Math.abs(g.x - g.spawnX);
    // Caps at 0.6 opacity (never fully solid) so they're never mistaken for
    // the real ball, which is always drawn fully opaque.
    const alpha = Math.max(0, 1 - traveled / GHOST_FADE_DISTANCE) * 0.6;
    drawSprite(maceSprite, g.x, g.y, BALL_SIZE, BALL_SIZE, `rgba(255, 255, 255, ${alpha})`);
  });
}

// This is now the ONLY place game state lives on the client. We don't
// calculate any of this ourselves anymore — it just gets overwritten
// every time a "state" message arrives from the server.
let latestState = {
  leftPaddle: { y: 160 },
  rightPaddle: { y: 160 },
  ball: { x: canvas.width / 2, y: canvas.height / 2 },
  leftScore: 0,
  rightScore: 0,
};

// Which paddle THIS browser controls. The server tells us this right after
// we connect (see socket.onmessage below) — we don't decide it ourselves.
let myRole = null;

// --- Sound (synthesized, no audio files) ---
// AudioContext is the browser's audio-generation engine. Browsers block audio
// from playing until a real user interaction happens (autoplay policy), so
// we create it here but only actually .resume() it on the first keypress.
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();

// Core sound generator — takes an explicit startTime on the AUDIO clock
// (audioCtx.currentTime), not a JS setTimeout delay. Scheduling on the audio
// clock is what keeps a fast run of notes tight and glitch-free; setTimeout
// is only accurate to ~a few ms and would make an arpeggio sound sloppy.
function playToneAt(frequency, duration, startTime) {
  const osc = audioCtx.createOscillator(); // generates a raw waveform
  const gain = audioCtx.createGain(); // controls volume over time

  osc.type = "square"; // harsher, more "retro" waveform than a smooth sine
  osc.frequency.value = frequency;

  gain.gain.setValueAtTime(0.3, startTime);
  gain.gain.exponentialRampToValueAtTime(0.001, startTime + duration);

  osc.connect(gain); // route oscillator's raw sound through the volume control
  gain.connect(audioCtx.destination); // ...then out to your speakers

  osc.start(startTime);
  osc.stop(startTime + duration);
}

// Convenience wrapper for a single immediate tone (used by playHit).
function playTone(frequency, duration) {
  playToneAt(frequency, duration, audioCtx.currentTime);
}

// Bounce sound — one note per surface, all from the same A minor triad so
// they still feel related: left paddle = A, wall = C (neutral/middle),
// right paddle = E.
function playHit(side) {
  if (side === "left") {
    playTone(220.0, 0.15); // A3
  } else if (side === "right") {
    playTone(329.63, 0.15); // E4
  } else {
    playTone(261.63, 0.15); // C4 — wall bounce, neutral
  }
}

// A minor arpeggio (A3 - C4 - E4 - A4), played fast on a square wave — an
// 8-bit take on a quick folk-metal-style lead run. `side` is which player
// scored: "left" plays it ascending, "right" plays the same notes in
// reverse (descending) so the two are audibly opposite.
function playScore(side) {
  const now = audioCtx.currentTime;
  const ascending = [220.0, 261.63, 329.63, 440.0];
  const notes = side === "right" ? [...ascending].reverse() : ascending;
  const noteGap = 0.08; // seconds between each note starting
  notes.forEach((freq, i) => {
    playToneAt(freq, noteGap * 0.9, now + i * noteGap);
  });
}

// A harmonic minor scale, A3 up to A4 (8 notes spanning an octave). Harmonic
// minor is natural minor with a raised 7th (the G# here, instead of a plain
// G) — that raised note is what gives it the "neoclassical/exotic" edge
// compared to a plain minor scale.
function playParry() {
  const now = audioCtx.currentTime;
  // Cut down from the full 8-note scale to just 4 — still lands on the
  // raised-7th (G#4) that gave it the "harmonic minor" flavor, but the whole
  // thing now finishes in ~240ms instead of ~1s, since a boosted parry can
  // send the ball across the whole court in well under a second.
  const notes = [
    220.0, // A3
    261.63, // C4
    415.3, // G#4 — the raised 7th
    440.0, // A4
  ];
  const noteGap = 0.06;
  notes.forEach((freq, i) => {
    playToneAt(freq, noteGap * 0.9, now + i * noteGap);
  });
}

// Tracks the ball's previous direction so we can detect the exact moment it
// changes (i.e. a bounce/hit just happened) when a new state arrives.
let prevBallDx = null;
let prevBallDy = null;

// Tracks scores so we can tell "a point was just scored" apart from
// "the ball just bounced" — both cause ball.dx to flip sign, so direction
// alone can't tell them apart.
let prevLeftScore = 0;
let prevRightScore = 0;

// Tracks the parry counter the same way — lets us detect "a parry just
// succeeded" separately from an ordinary bounce.
let prevParryCount = 0;

// Same trick again for Ghosthit — lets us detect "a mirror-spawning hit just
// happened" separately from an ordinary bounce.
let prevGhostHitCount = 0;

// Opens the connection to server.js. Nothing is sent yet — this just
// establishes the pipe. "ws://" is the WebSocket equivalent of "http://".
// location.hostname is whatever address THIS PAGE was actually loaded from
// (e.g. "localhost" on your PC, or the EC2 public IP for your friend) — using
// it instead of a hardcoded "localhost" means the same game.js works
// correctly no matter where it's being served from.
const socket = new WebSocket(`ws://${location.hostname}:8080`);

// Fires once, as soon as the connection is successfully established.
socket.onopen = () => {
  console.log("Connected to server");
};

// Fires every time the SERVER sends US a message. This replaces our old
// update() function entirely — we no longer calculate positions ourselves,
// we just receive them.
socket.onmessage = (event) => {
  const msg = JSON.parse(event.data);

  if (msg.type === "role") {
    // Told once, right after connecting: which paddle do we control?
    myRole = msg.role;
    console.log("You are:", myRole);
  } else if (msg.type === "state") {
    // Check for a score FIRST — a score also flips ball.dx (via resetBall on
    // the server), so if we checked direction first we'd fire playHit() and
    // playScore() on the same tick. Scoring takes priority; if it happened,
    // skip the bounce check entirely for this tick.
    // Note: leftScore increments when the RIGHT player let the ball past —
    // i.e. leftScore changing means the LEFT player just scored a point.
    const leftScored = msg.leftScore !== prevLeftScore;
    const rightScored = msg.rightScore !== prevRightScore;

    const parried = msg.parryCount !== prevParryCount;

    if (leftScored) {
      playScore("left");
    } else if (rightScored) {
      playScore("right");
    } else if (parried) {
      // A successful parry gets its own special sound INSTEAD of the normal
      // bounce thud — checked before the regular bounce detection below so
      // the two don't both fire on the same tick.
      playParry();
    } else if (prevBallDx !== null) {
      // Detect a bounce: compare the ball's direction in this new state
      // against last time. A flipped sign means it just hit something.
      // Skipped on the very first message (prevBallDx is still null) since
      // there's nothing to compare yet.
      const dxFlipped = Math.sign(msg.ball.dx) !== Math.sign(prevBallDx);
      const dyFlipped = Math.sign(msg.ball.dy) !== Math.sign(prevBallDy);

      if (dxFlipped) {
        // Ball was moving left (negative dx) and is now moving right
        // (positive) => it just bounced off the LEFT paddle, and vice versa.
        if (prevBallDx < 0 && msg.ball.dx > 0) playHit("left");
        else if (prevBallDx > 0 && msg.ball.dx < 0) playHit("right");
      }
      if (dyFlipped) playHit(); // wall bounce — no side, use the neutral tone
    }

    // Checked independently of the sound logic above — a Ghosthit can land
    // on the same tick as a bounce sound, and both should still happen.
    if (msg.ghostHitCount !== prevGhostHitCount) {
      spawnGhostBalls(msg.ball);
    }

    prevBallDx = msg.ball.dx;
    prevBallDy = msg.ball.dy;
    prevLeftScore = msg.leftScore;
    prevRightScore = msg.rightScore;
    prevParryCount = msg.parryCount;
    prevGhostHitCount = msg.ghostHitCount;

    // Sent 60x/sec: the current positions of everything. We just store it —
    // draw() (below) is what actually renders it to the screen.
    latestState = msg;
  } else if (msg.type === "full") {
    alert("Game is full — try again later.");
  }
};

// Tracks which movement keys THIS player is currently holding. Same idea as
// before, except now we don't move paddles directly from this — we just
// report it to the server.
const keyState = { up: false, down: false };

function sendInput() {
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({ type: "input", ...keyState }));
  }
}

document.addEventListener("keydown", (e) => {
  updateKeyState(e.key, true);
});
document.addEventListener("keyup", (e) => {
  updateKeyState(e.key, false);
});

// Sends a "pause" message; the server toggles it and broadcasts the new
// state to both players, so calling this in one tab freezes the game in
// both. Declared with `function` (not `const ... =>`) specifically so it's
// a real named function you can also call directly from the browser
// console — try typing togglePause() into DevTools instead of clicking.
function togglePause() {
  if (audioCtx.state === "suspended") {
    audioCtx.resume();
  }
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({ type: "pause" }));
  }
}

const pauseBtn = document.getElementById("pauseBtn");
pauseBtn.addEventListener("click", togglePause);

// Shorter alias for the console — `window.x = ...` explicitly attaches x as
// a global, which is how you make a shorthand name callable from DevTools
// (a plain `const pause = togglePause` would NOT be console-callable, since
// top-level let/const aren't attached to `window` the way `function`
// declarations are).
window.pause = togglePause;

function updateKeyState(key, isPressed) {
  // Browsers won't let audio play until a real user interaction happens —
  // a keypress counts, so this unlocks sound the first time any key is hit.
  if (audioCtx.state === "suspended") {
    audioCtx.resume();
  }

  // Left player uses W/S, right player uses Arrow Up/Down — but each
  // browser only controls ONE paddle (whichever `myRole` we were assigned),
  // so we check both key sets and just map whichever matches to up/down.
  if (key === "w" || key === "ArrowUp") {
    keyState.up = isPressed;
    sendInput();
  } else if (key === "s" || key === "ArrowDown") {
    keyState.down = isPressed;
    sendInput();
  } else if (key.toLowerCase() === "f" && isPressed) {
    // Only send on the actual press (isPressed), not on release — a parry
    // is a single instant, not something you hold. The server just records
    // when this arrived and checks the timing itself when the ball reaches
    // your paddle, so nothing else needs to happen here.
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: "parry" }));
    }
  } else if (key.toLowerCase() === "c" && isPressed) {
    // Same one-shot-on-press idea as parry. The server decides whether we
    // actually have enough points to arm it — we just ask.
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: "ghosthit" }));
    }
  }
}

// --- Background: dark castle backdrop ---
// Every shape here uses dark, desaturated grays — well above pure black so
// they actually read as shapes, but nowhere near white. That's what keeps
// the ball/paddles visible even where they cross directly in front of the
// skyline: contrast, not screen position (the ball travels through the
// entire canvas height, so there's no "safe" empty zone to hide art in).
const SKY_COLOR = "#0b0b12"; // slightly blue-black "night sky", not pure #000
const STONE_COLOR = "#1c1c26";
const WINDOW_GLOW = "rgba(255, 200, 80, 0.15)"; // faint, warm, low-opacity

// Fixed (not random) tower heights — same skyline every load, so it's easy
// to reason about and tweak rather than chasing a moving target.
const TOWER_HEIGHTS = [30, 50, 35, 60, 25, 45];
const TOWER_WIDTH = 40;
const SKYLINE_BASE_Y = 70; // skyline occupies roughly the top 70px

// The score/mana text sits around x 310-480, y 18-78 — no tower gets drawn
// in this x range at all, so the text is never rendered over busy pixel
// art. GATE_GAP_END - GATE_GAP_START matches roughly that text width.
const GATE_GAP_START = 320;
const GATE_GAP_END = 480;

// Moat + gate fill that gap, but sit BELOW it (y >= 80, once the text's
// vertical extent has ended) rather than on the towers' shared baseline —
// that's what keeps them from overlapping the text without needing to
// shrink them down to nothing.
const MOAT_COLOR = "#0a1a2a";
const MOAT_Y = 80;
const MOAT_HEIGHT = 8;
const GATE_COLOR = "#141420";
const GATE_DOORWAY_COLOR = "#000000";

function drawCastleBackground() {
  ctx.fillStyle = SKY_COLOR;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  for (let x = 0; x < canvas.width; x += TOWER_WIDTH) {
    if (x >= GATE_GAP_START && x < GATE_GAP_END) continue; // gap for the score/mana text

    const towerHeight = TOWER_HEIGHTS[(x / TOWER_WIDTH) % TOWER_HEIGHTS.length];
    ctx.fillStyle = STONE_COLOR;
    ctx.fillRect(x, SKYLINE_BASE_Y - towerHeight, TOWER_WIDTH - 6, towerHeight);

    // Crenellations: notches cut into each tower's top, redrawn in the sky
    // color rather than cleared, so it stays a flat, crisp pixel-art look.
    ctx.fillStyle = SKY_COLOR;
    for (let n = 0; n < TOWER_WIDTH - 6; n += 10) {
      ctx.fillRect(x + n, SKYLINE_BASE_Y - towerHeight, 5, 6);
    }

    // One dim window glow near each tower's base.
    ctx.fillStyle = WINDOW_GLOW;
    ctx.fillRect(x + TOWER_WIDTH / 2 - 3, SKYLINE_BASE_Y - 15, 6, 8);
  }

  // Moat: a dark water band spanning the full width, marking a clean line
  // between the distant skyline and the playing field below it.
  ctx.fillStyle = MOAT_COLOR;
  ctx.fillRect(0, MOAT_Y, canvas.width, MOAT_HEIGHT);

  // Gate: fills the gap between the two flanking tower groups, framed by
  // stone with a darker doorway cut into its center.
  const gateY = MOAT_Y + MOAT_HEIGHT;
  const gateHeight = 24;
  ctx.fillStyle = GATE_COLOR;
  ctx.fillRect(GATE_GAP_START, gateY, GATE_GAP_END - GATE_GAP_START, gateHeight);
  ctx.fillStyle = GATE_DOORWAY_COLOR;
  ctx.fillRect(GATE_GAP_START + 40, gateY + 4, GATE_GAP_END - GATE_GAP_START - 80, gateHeight - 4);

  // Flanking stone pillars in the margins outside the paddles — the ball
  // and paddles never enter x < LEFT_X or x > RIGHT_X + PADDLE_WIDTH, so
  // detail here carries zero contrast risk. The W/S/F/C key hints (drawn
  // later, in white) sit on top of this.
  ctx.fillRect(0, 0, LEFT_X - 4, canvas.height);
  ctx.fillRect(RIGHT_X + PADDLE_WIDTH + 4, 0, canvas.width, canvas.height);
}

function draw() {
  drawCastleBackground();

  // --- Ball trail: draw OLDER positions first, each fainter than the last,
  // so the most recent trail position is the most visible. This has to
  // happen before drawing the current ball so the trail sits "behind" it.
  ballTrail.forEach((pos, i) => {
    const age = i / ballTrail.length; // 0 = oldest, close to 1 = newest
    ctx.fillStyle = `rgba(255, 255, 255, ${age * 0.3})`;
    ctx.fillRect(pos.x, pos.y, BALL_SIZE, BALL_SIZE);
  });

  drawSprite(longswordSprite, LEFT_X, latestState.leftPaddle.y, PADDLE_WIDTH, PADDLE_HEIGHT, "white");
  drawSprite(saberSprite, RIGHT_X, latestState.rightPaddle.y, PADDLE_WIDTH, PADDLE_HEIGHT, "white");
  // Mirrors drawn before the real ball so the real one always reads as the
  // solid, "on top" one even where they overlap.
  drawGhostBalls();
  drawSprite(maceSprite, latestState.ball.x, latestState.ball.y, BALL_SIZE, BALL_SIZE, "white");

  // Record this frame's ball position for next frame's trail, then trim
  // back down to TRAIL_LENGTH so it doesn't grow forever.
  ballTrail.push({ x: latestState.ball.x, y: latestState.ball.y });
  if (ballTrail.length > TRAIL_LENGTH) {
    ballTrail.shift();
  }

  ctx.font = "32px sans-serif";
  ctx.fillStyle = "white";
  ctx.fillText(latestState.leftScore, canvas.width / 2 - 50, 50);
  ctx.fillText(latestState.rightScore, canvas.width / 2 + 30, 50);

  // Ghosthit points, per side — labeled "Mana" instead of "Pts" so it can't
  // be confused with the score above it, and reads as part of the same
  // castle/medieval theme as the tower paddles and mace ball.
  ctx.font = "16px sans-serif";
  ctx.fillStyle = latestState.leftPoints >= GHOSTHIT_COST ? "#7CFC00" : "white";
  ctx.fillText(`Mana: ${latestState.leftPoints ?? 0}`, canvas.width / 2 - 90, 75);
  ctx.fillStyle = latestState.rightPoints >= GHOSTHIT_COST ? "#7CFC00" : "white";
  ctx.fillText(`Mana: ${latestState.rightPoints ?? 0}`, canvas.width / 2 + 30, 75);

  // Controls legend — always visible, tucked into the empty space below the
  // playing field.
  ctx.font = "14px sans-serif";
  ctx.fillStyle = "white";
  ctx.textAlign = "center";
  ctx.fillText("W / S: Move     F: Parry     C: Ghosthit", canvas.width / 2, canvas.height - 10);
  ctx.textAlign = "left";

  // Same keys again, as a quick-glance reminder in the narrow strips outside
  // each paddle — x < LEFT_X on the left, x > RIGHT_X + PADDLE_WIDTH on the
  // right — which the ball/paddles never enter, so nothing else ever draws
  // there. Centered under each letter for a clean stacked look.
  ctx.font = "11px sans-serif";
  ctx.textAlign = "center";
  const keyLabels = ["W", "S", "F", "C"];
  keyLabels.forEach((label, i) => {
    const y = 150 + i * 20;
    ctx.fillText(label, 10, y);
    ctx.fillText(label, canvas.width - 10, y);
  });
  ctx.textAlign = "left";

  if (latestState.waiting) {
    ctx.font = "24px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("Waiting for opponent...", canvas.width / 2, canvas.height / 2 - 30);
    ctx.textAlign = "left"; // reset so it doesn't affect the score text above next frame
  } else if (latestState.paused) {
    ctx.font = "24px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("PAUSED", canvas.width / 2, canvas.height / 2 - 30);
    ctx.textAlign = "left";
  }

  // --- CRT scanlines: a faint dark line every 4px across the whole canvas,
  // drawn LAST so it overlays everything else (paddles, ball, text). This is
  // literally the "gap between scan rows" on an old CRT monitor.
  ctx.fillStyle = "rgba(0, 0, 0, 0.15)";
  for (let y = 0; y < canvas.height; y += 4) {
    ctx.fillRect(0, y, canvas.width, 1);
  }
}

// We still need a render loop — but note it ONLY calls draw() now, never
// update(). The server is doing all the physics; we just redraw whatever
// the latest received state is, as fast as the browser can (~60fps).
function loop() {
  updateGhostBalls();
  draw();
  requestAnimationFrame(loop);
}

loop();
