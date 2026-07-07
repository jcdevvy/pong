// "ws" is the npm package we installed — it's what lets a plain Node.js
// program speak the WebSocket protocol (persistent, two-way connections).
const { WebSocketServer } = require("ws");
// "http" and "fs"/"path" are BUILT INTO Node — no npm install needed. "http"
// lets us serve regular web pages; "fs" reads files off disk; "path" builds
// file paths safely across operating systems.
const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = 8080;

// Maps a file extension to the header browsers need to know how to treat
// the response (otherwise a .js file might get served as plain text and
// silently fail to run).
const CONTENT_TYPES = {
  ".html": "text/html",
  ".js": "text/javascript",
};

// A plain HTTP server: whenever a browser requests a page (e.g. visiting
// http://your-server:8080/), this reads the matching file off disk and
// sends it back. "/" maps to index.html, same as any normal website.
const httpServer = http.createServer((req, res) => {
  const filePath = req.url === "/" ? "index.html" : req.url.slice(1);
  const fullPath = path.join(__dirname, filePath);
  const ext = path.extname(fullPath);

  fs.readFile(fullPath, (err, content) => {
    if (err) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }
    res.writeHead(200, { "Content-Type": CONTENT_TYPES[ext] || "text/plain" });
    res.end(content);
  });
});

// Attaching the WebSocket server to the SAME httpServer (via the `server`
// option, instead of its own `port`) means both regular web pages AND
// WebSocket connections come through port 8080 together — one address for
// your friend to connect to, not two.
const wss = new WebSocketServer({ server: httpServer });

// These match the values in game.js's canvas — the server needs to know the
// playing field size to do the same bounce/collision math the client used to do.
const CANVAS_WIDTH = 800;
const CANVAS_HEIGHT = 400;
const PADDLE_WIDTH = 10;
const PADDLE_HEIGHT = 80;
const PADDLE_SPEED = 6;
const BALL_SIZE = 8;

// Normal ball speed. Both dx and dy share this same value (so the ball
// always travels on a perfect diagonal), which is what makes "speed" a
// single number instead of two separate constants.
const BASE_SPEED = 6;

// A player only counts as "parrying" if they pressed F within this many ms
// before the ball actually reaches their paddle. 50ms (~3 frames) proved too
// tight in testing; 150ms felt a bit loose. 125ms splits the difference —
// tune further based on feel.
const PARRY_WINDOW_MS = 125;
const PARRY_SPEED_BONUS = 6; // added to current speed per successful parry
const MAX_SPEED = 24;

// Tracks which WebSocket connection belongs to which player.
// Starts empty; gets filled in as people connect (see wss.on("connection") below).
let players = {}; // { left: ws, right: ws }

// The single source of truth for "what does the game currently look like."
// This is the ONLY place ball/paddle positions live now — browsers no longer
// track their own; they just display whatever this object says.
const state = {
  leftPaddle: { y: 160 },
  rightPaddle: { y: 160 },
  ball: { x: CANVAS_WIDTH / 2, y: CANVAS_HEIGHT / 2, dx: BASE_SPEED, dy: BASE_SPEED, speed: BASE_SPEED },
  leftScore: 0,
  rightScore: 0,
  paused: false, // either player can toggle this; freezes the whole game for both
  parryCount: 0, // increments on every successful parry — clients watch for
  // this changing (same trick as leftScore/rightScore) to know when to play
  // the parry sound, since a momentary boolean could get missed between ticks.
};

// Timestamp (ms) of each player's most recent "parry" key press — 0 means
// "hasn't pressed it (recently)." Checked at the moment of paddle collision
// to decide whether it counts as a parry.
const lastParryPress = { left: 0, right: 0 };

// What keys each player currently has held down. Updated whenever a client
// sends an "input" message (see ws.on("message") below), read every tick by
// update() to decide whether to move a paddle.
const inputs = {
  left: { up: false, down: false },
  right: { up: false, down: false },
};

// Timestamp (ms) until which the ball should stay frozen at center — set
// after a score, cleared once time's up. 0 means "not serving, play normally."
let serveDelayUntil = 0;
const SERVE_DELAY_MS = 2000;

// Fires once per browser that connects to this server (i.e. once per player).
wss.on("connection", (ws) => {
  let role = null;

  // Assign roles first-come-first-served: 1st connection = left paddle,
  // 2nd = right paddle, anyone after that gets rejected (game's full).
  if (!players.left) {
    role = "left";
    players.left = ws;
  } else if (!players.right) {
    role = "right";
    players.right = ws;
  } else {
    ws.send(JSON.stringify({ type: "full" }));
    ws.close();
    return;
  }

  console.log(`Player connected as ${role}`);
  // Tell this browser which paddle it controls, so its game.js knows which
  // key events to actually send (left player's W/S vs right player's arrows).
  ws.send(JSON.stringify({ type: "role", role }));

  // Fires every time this specific browser sends us a message.
  // WebSocket messages are just text — JSON.parse turns it back into an object.
  ws.on("message", (raw) => {
    const msg = JSON.parse(raw);
    if (msg.type === "input") {
      // Overwrite this player's held-key state. We don't move the paddle
      // here directly — update() does that on the next tick, using whatever
      // the most recent input state is.
      inputs[role].up = msg.up;
      inputs[role].down = msg.down;
    } else if (msg.type === "pause") {
      // Either player can toggle this — flip it for both, since state is shared.
      state.paused = !state.paused;
    } else if (msg.type === "parry") {
      // Just record WHEN this happened — update() checks how recent this
      // timestamp is at the exact moment the ball reaches this player's
      // paddle, rather than us deciding right now whether it "counts."
      lastParryPress[role] = Date.now();
    }
  });

  // Fires when a browser tab closes or loses connection.
  ws.on("close", () => {
    console.log(`Player ${role} disconnected`);
    players[role] = null; // frees up that slot for a new player to join as
    // Park the ball back at center so the next match starts clean instead of
    // resuming wherever it happened to be when this player left.
    state.ball.x = CANVAS_WIDTH / 2;
    state.ball.y = CANVAS_HEIGHT / 2;
  });
});

// This is essentially your old client-side update() from game.js, moved
// here almost unchanged. The difference: it reads from `inputs` (set by
// whatever the browsers sent us) instead of a browser's own `keys` object,
// and it mutates the server's single shared `state` instead of local variables.
function update() {
  // Nobody to play against yet — don't run any physics at all. The ball
  // stays parked wherever resetBall() last put it (dead center).
  state.waiting = !(players.left && players.right);
  if (state.waiting) {
    return;
  }

  // Frozen — skip paddles AND ball entirely until someone unpauses.
  if (state.paused) {
    return;
  }

  // Paddle movement — same bounds-checking as before (don't move off-canvas).
  if (inputs.left.up && state.leftPaddle.y > 0) state.leftPaddle.y -= PADDLE_SPEED;
  if (inputs.left.down && state.leftPaddle.y < CANVAS_HEIGHT - PADDLE_HEIGHT) state.leftPaddle.y += PADDLE_SPEED;
  if (inputs.right.up && state.rightPaddle.y > 0) state.rightPaddle.y -= PADDLE_SPEED;
  if (inputs.right.down && state.rightPaddle.y < CANVAS_HEIGHT - PADDLE_HEIGHT) state.rightPaddle.y += PADDLE_SPEED;

  // While serving, paddles can still move (checks above already ran) but the
  // ball stays frozen at center — skip all ball movement/collision below.
  if (Date.now() < serveDelayUntil) {
    return;
  }

  const ball = state.ball;
  ball.x += ball.dx;
  ball.y += ball.dy;

  // Bounce off top/bottom walls.
  if (ball.y <= 0 || ball.y >= CANVAS_HEIGHT - BALL_SIZE) {
    ball.dy *= -1;
  }

  // Paddle x-positions are fixed (paddles only move up/down), so we can
  // just hardcode them here rather than storing them in `state`.
  const leftX = 20;
  const rightX = CANVAS_WIDTH - 20 - PADDLE_WIDTH;

  // Bounce off left paddle: ball's box overlaps the paddle's box.
  if (
    ball.x <= leftX + PADDLE_WIDTH &&
    ball.y + BALL_SIZE >= state.leftPaddle.y &&
    ball.y <= state.leftPaddle.y + PADDLE_HEIGHT
  ) {
    applyPaddleHit("left", 1); // ball now heads right (+dx)
    ball.x = leftX + PADDLE_WIDTH; // snap ball out of the paddle so it doesn't get "stuck" re-triggering this
  }

  // Bounce off right paddle — mirror of the left-paddle check above.
  if (
    ball.x + BALL_SIZE >= rightX &&
    ball.y + BALL_SIZE >= state.rightPaddle.y &&
    ball.y <= state.rightPaddle.y + PADDLE_HEIGHT
  ) {
    applyPaddleHit("right", -1); // ball now heads left (-dx)
    ball.x = rightX - BALL_SIZE;
  }

  // Ball passed a paddle entirely — someone scored.
  if (ball.x < 0) {
    state.rightScore++;
    resetBall();
  } else if (ball.x > CANVAS_WIDTH) {
    state.leftScore++;
    resetBall();
  }
}

// Runs whenever the ball hits a paddle. `side` is "left"/"right" (whose
// paddle got hit); `dxSign` is which horizontal direction the ball should
// now travel (+1 = rightward, -1 = leftward).
//
// Speed rule: a normal hit resets speed back to BASE_SPEED. A PARRIED hit (F
// pressed within PARRY_WINDOW_MS of this exact moment) instead ADDS
// PARRY_SPEED_BONUS to whatever the current speed already was, capped at
// MAX_SPEED — so three parries in a row chain: 6 -> 12 -> 18 -> 24 (capped).
function applyPaddleHit(side, dxSign) {
  const isParry = Date.now() - lastParryPress[side] <= PARRY_WINDOW_MS;
  const ball = state.ball;

  ball.speed = isParry
    ? Math.min(ball.speed + PARRY_SPEED_BONUS, MAX_SPEED)
    : BASE_SPEED;

  if (isParry) {
    state.parryCount++;
  }

  // Recompute velocity from the current speed — this is what actually makes
  // the ball faster, not just direction change. dy keeps whatever vertical
  // direction it already had (wall bounces control that sign independently);
  // only its magnitude gets rescaled.
  ball.dx = dxSign * ball.speed;
  ball.dy = Math.sign(ball.dy) * ball.speed;
}

// Re-centers the ball and sends it toward whoever just got scored on.
// Speed always resets to BASE_SPEED here — a boosted rally shouldn't carry
// its speed into the next point.
function resetBall() {
  const servingDirection = -Math.sign(state.ball.dx) || 1; // toward whoever just conceded
  state.ball.x = CANVAS_WIDTH / 2;
  state.ball.y = CANVAS_HEIGHT / 2;
  state.ball.dx = servingDirection * BASE_SPEED;
  state.ball.dy = BASE_SPEED;
  state.ball.speed = BASE_SPEED;
  // Freeze the ball here for SERVE_DELAY_MS — update() checks this and
  // returns early until the delay passes.
  serveDelayUntil = Date.now() + SERVE_DELAY_MS;
}

// Sends the current `state` to both connected players. This is how the two
// browsers stay in sync — they never talk to each other directly, only to
// the server, which is the single shared source of truth.
function broadcast() {
  const payload = JSON.stringify({ type: "state", ...state });
  for (const role of ["left", "right"]) {
    // readyState === OPEN guards against sending to a player who
    // disconnected mid-tick (their socket object still exists briefly
    // after closing).
    if (players[role] && players[role].readyState === players[role].OPEN) {
      players[role].send(payload);
    }
  }
}

// The heartbeat of the whole server: 60 times per second, recalculate the
// game state and push it out to both players. This is the server-side
// equivalent of the requestAnimationFrame loop your old client-only game.js used.
setInterval(() => {
  update();
  broadcast();
}, 1000 / 60);

// Start the combined HTTP + WebSocket server. Note we call .listen() on
// httpServer now, not on a bare port — the WebSocketServer above is just
// piggybacking on this same listener.
httpServer.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
