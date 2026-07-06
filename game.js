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

// Castle tower: crenellations (the notched battlements) at the top, solid
// stone shaft below.
const towerSprite = [
  [1, 0, 1, 0, 1, 0, 1, 0],
  [1, 0, 1, 0, 1, 0, 1, 0],
  [1, 1, 1, 1, 1, 1, 1, 1],
  [1, 1, 1, 1, 1, 1, 1, 1],
  [0, 1, 1, 1, 1, 1, 1, 0],
  [0, 1, 1, 1, 1, 1, 1, 0],
  [0, 1, 1, 1, 1, 1, 1, 0],
  [0, 1, 1, 1, 1, 1, 1, 0],
  [0, 1, 1, 1, 1, 1, 1, 0],
  [0, 1, 1, 1, 1, 1, 1, 0],
  [0, 1, 1, 1, 1, 1, 1, 0],
  [0, 1, 1, 1, 1, 1, 1, 0],
  [0, 1, 1, 1, 1, 1, 1, 0],
  [0, 1, 1, 1, 1, 1, 1, 0],
  [0, 1, 1, 1, 1, 1, 1, 0],
  [0, 1, 1, 1, 1, 1, 1, 0],
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

// Tracks the ball's previous direction so we can detect the exact moment it
// changes (i.e. a bounce/hit just happened) when a new state arrives.
let prevBallDx = null;
let prevBallDy = null;

// Tracks scores so we can tell "a point was just scored" apart from
// "the ball just bounced" — both cause ball.dx to flip sign, so direction
// alone can't tell them apart.
let prevLeftScore = 0;
let prevRightScore = 0;

// Opens the connection to server.js. Nothing is sent yet — this just
// establishes the pipe. "ws://" is the WebSocket equivalent of "http://".
const socket = new WebSocket("ws://localhost:8080");

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

    if (leftScored) {
      playScore("left");
    } else if (rightScored) {
      playScore("right");
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

    prevBallDx = msg.ball.dx;
    prevBallDy = msg.ball.dy;
    prevLeftScore = msg.leftScore;
    prevRightScore = msg.rightScore;

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
  }
}

function draw() {
  ctx.fillStyle = "black";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // --- Ball trail: draw OLDER positions first, each fainter than the last,
  // so the most recent trail position is the most visible. This has to
  // happen before drawing the current ball so the trail sits "behind" it.
  ballTrail.forEach((pos, i) => {
    const age = i / ballTrail.length; // 0 = oldest, close to 1 = newest
    ctx.fillStyle = `rgba(255, 255, 255, ${age * 0.3})`;
    ctx.fillRect(pos.x, pos.y, BALL_SIZE, BALL_SIZE);
  });

  drawSprite(towerSprite, LEFT_X, latestState.leftPaddle.y, PADDLE_WIDTH, PADDLE_HEIGHT, "white");
  drawSprite(towerSprite, RIGHT_X, latestState.rightPaddle.y, PADDLE_WIDTH, PADDLE_HEIGHT, "white");
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
  draw();
  requestAnimationFrame(loop);
}

loop();
