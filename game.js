const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");

const PADDLE_WIDTH = 10;
const PADDLE_HEIGHT = 80;
const PADDLE_SPEED = 6;
const BALL_SIZE = 8;

const leftPaddle = { x: 20, y: 160 };
const rightPaddle = { x: canvas.width - 20 - PADDLE_WIDTH, y: 160 };
const ball = { x: canvas.width / 2, y: canvas.height / 2, dx: 4, dy: 3 };

let leftScore = 0;
let rightScore = 0;

const keys = {};
document.addEventListener("keydown", (e) => (keys[e.key] = true));
document.addEventListener("keyup", (e) => (keys[e.key] = false));

function update() {
  // left paddle: W/S, right paddle: Arrow Up/Down
  if (keys["w"] && leftPaddle.y > 0) leftPaddle.y -= PADDLE_SPEED;
  if (keys["s"] && leftPaddle.y < canvas.height - PADDLE_HEIGHT) leftPaddle.y += PADDLE_SPEED;
  if (keys["ArrowUp"] && rightPaddle.y > 0) rightPaddle.y -= PADDLE_SPEED;
  if (keys["ArrowDown"] && rightPaddle.y < canvas.height - PADDLE_HEIGHT) rightPaddle.y += PADDLE_SPEED;

  ball.x += ball.dx;
  ball.y += ball.dy;

  // bounce off top/bottom
  if (ball.y <= 0 || ball.y >= canvas.height - BALL_SIZE) {
    ball.dy *= -1;
  }

  // bounce off left paddle
  if (
    ball.x <= leftPaddle.x + PADDLE_WIDTH &&
    ball.y + BALL_SIZE >= leftPaddle.y &&
    ball.y <= leftPaddle.y + PADDLE_HEIGHT
  ) {
    ball.dx *= -1;
    ball.x = leftPaddle.x + PADDLE_WIDTH;
  }

  // bounce off right paddle
  if (
    ball.x + BALL_SIZE >= rightPaddle.x &&
    ball.y + BALL_SIZE >= rightPaddle.y &&
    ball.y <= rightPaddle.y + PADDLE_HEIGHT
  ) {
    ball.dx *= -1;
    ball.x = rightPaddle.x - BALL_SIZE;
  }

  // scoring
  if (ball.x < 0) {
    rightScore++;
    resetBall();
  } else if (ball.x > canvas.width) {
    leftScore++;
    resetBall();
  }
}

function resetBall() {
  ball.x = canvas.width / 2;
  ball.y = canvas.height / 2;
  ball.dx *= -1;
}

function draw() {
  ctx.fillStyle = "black";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.fillStyle = "white";
  ctx.fillRect(leftPaddle.x, leftPaddle.y, PADDLE_WIDTH, PADDLE_HEIGHT);
  ctx.fillRect(rightPaddle.x, rightPaddle.y, PADDLE_WIDTH, PADDLE_HEIGHT);
  ctx.fillRect(ball.x, ball.y, BALL_SIZE, BALL_SIZE);

  ctx.font = "32px sans-serif";
  ctx.fillText(leftScore, canvas.width / 2 - 50, 50);
  ctx.fillText(rightScore, canvas.width / 2 + 30, 50);
}

function loop() {
  update();
  draw();
  requestAnimationFrame(loop);
}

loop();
