// "ws" is the npm package we installed — it's what lets a plain Node.js
// program speak the WebSocket protocol (persistent, two-way connections).
const { WebSocketServer } = require("ws");

const PORT = 8080;
// Creating this starts the server listening immediately — from this point on,
// any browser that connects to ws://localhost:8080 triggers the "connection"
// event below.
const wss = new WebSocketServer({ port: PORT });

// These match the values in game.js's canvas — the server needs to know the
// playing field size to do the same bounce/collision math the client used to do.
const CANVAS_WIDTH = 800;
const CANVAS_HEIGHT = 400;
const PADDLE_WIDTH = 10;
const PADDLE_HEIGHT = 80;
const PADDLE_SPEED = 6;
const BALL_SIZE = 8;

// Tracks which WebSocket connection belongs to which player.
// Starts empty; gets filled in as people connect (see wss.on("connection") below).
let players = {}; // { left: ws, right: ws }

// The single source of truth for "what does the game currently look like."
// This is the ONLY place ball/paddle positions live now — browsers no longer
// track their own; they just display whatever this object says.
const state = {
  leftPaddle: { y: 160 },
  rightPaddle: { y: 160 },
  ball: { x: CANVAS_WIDTH / 2, y: CANVAS_HEIGHT / 2, dx: 4, dy: 3 },
  leftScore: 0,
  rightScore: 0,
  paused: false, // either player can toggle this; freezes the whole game for both
};

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
    ball.dx *= -1;
    ball.x = leftX + PADDLE_WIDTH; // snap ball out of the paddle so it doesn't get "stuck" re-triggering this
  }

  // Bounce off right paddle — mirror of the left-paddle check above.
  if (
    ball.x + BALL_SIZE >= rightX &&
    ball.y + BALL_SIZE >= state.rightPaddle.y &&
    ball.y <= state.rightPaddle.y + PADDLE_HEIGHT
  ) {
    ball.dx *= -1;
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

// Re-centers the ball and sends it toward whoever just got scored on
// (flipping dx reverses its horizontal direction).
function resetBall() {
  state.ball.x = CANVAS_WIDTH / 2;
  state.ball.y = CANVAS_HEIGHT / 2;
  state.ball.dx *= -1;
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

console.log(`WebSocket server running on ws://localhost:${PORT}`);
