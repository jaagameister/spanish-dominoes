// Interface. All game logic lives in the engine; this file only renders state
// and turns clicks into engine calls.

import {
  createGame,
  startHand,
  legalMoves,
  play,
  pass,
  ends,
  teamOf,
  DEFAULT_TARGET,
} from '../engine/game.js';
import { chooseMove } from '../engine/bot.js';
import { totalPips, isDouble } from '../engine/tiles.js';

const HUMAN = 0;
const LABEL = ['You', 'Left', 'Partner', 'Right'];
const BOT_PAUSE = 850;

/** Where each seat sits on the table grid. */
const POSITION = { 1: 'seat--west', 2: 'seat--north', 3: 'seat--east' };

/** Pip positions in a row-major 3x3 grid. */
const PIP_CELLS = {
  0: [],
  1: [4],
  2: [0, 8],
  3: [0, 4, 8],
  4: [0, 2, 6, 8],
  5: [0, 2, 4, 6, 8],
  6: [0, 2, 3, 5, 6, 8],
};

const el = (id) => document.getElementById(id);

let game;
let selected = null; // tile id waiting on a choice of end
let timer = null;
let message = '';

// ----------------------------------------------------------------- tiles

function half(value) {
  const node = document.createElement('div');
  node.className = 'tile__half';
  const cells = PIP_CELLS[value];
  for (let i = 0; i < 9; i++) {
    const cell = document.createElement('span');
    if (cells.includes(i)) cell.className = 'pip';
    node.appendChild(cell);
  }
  return node;
}

/**
 * `first`/`second` are the two faces in reading order — left-to-right for a
 * horizontal tile, top-to-bottom for a vertical one.
 */
function tileNode(first, second, orientation) {
  const node = document.createElement('div');
  node.className = `tile tile--${orientation}`;
  node.append(half(first), half(second));
  return node;
}

// ----------------------------------------------------------------- render

function render() {
  const target = game.targetScore;
  el('score-us').textContent = game.scores[teamOf(HUMAN)];
  el('score-them').textContent = game.scores[1 - teamOf(HUMAN)];
  el('target').textContent = target;
  el('hand-number').textContent = `Hand ${game.handNumber}`;

  renderSeats();
  renderLine();
  renderHand();
  renderStatus();
  renderEndPicker();
}

function renderSeats() {
  for (const seat of [1, 2, 3]) {
    const panel = el(`seat-${seat}`);
    panel.className = `seat ${POSITION[seat]}`;
    if (seat === 2) panel.classList.add('seat--partner');
    if (game.turn === seat) panel.classList.add('seat--active');
    panel.innerHTML = '';

    const name = document.createElement('div');
    name.className = 'seat__name';
    name.textContent = seat === 2 ? 'Partner' : `${LABEL[seat]} opponent`;

    const count = document.createElement('div');
    count.className = 'seat__count';
    for (let i = 0; i < game.hands[seat].length; i++) {
      const back = document.createElement('span');
      back.className = 'back';
      count.appendChild(back);
    }

    const meta = document.createElement('div');
    meta.className = 'seat__meta';
    const held = game.hands[seat].length;
    meta.textContent = `${held} tile${held === 1 ? '' : 's'}`;

    panel.append(name, count, meta);

    // A pass is public information — every player at a real table tracks it.
    const voids = [...game.knownVoids[seat]].sort((a, b) => a - b);
    if (voids.length > 0) {
      const row = document.createElement('div');
      row.className = 'seat__voids';
      row.append('void in');
      for (const value of voids) {
        const chip = document.createElement('span');
        chip.className = 'void';
        chip.textContent = value;
        row.appendChild(chip);
      }
      panel.appendChild(row);
    }
  }
}

function renderLine() {
  const line = el('line');
  line.innerHTML = '';
  const open = ends(game);
  el('board-empty').hidden = game.line.length > 0;

  if (!open) return;

  const left = document.createElement('span');
  left.className = 'end-marker';
  left.textContent = `end ${open.left}`;
  line.appendChild(left);

  for (const placed of game.line) {
    // Doubles are laid crosswise, as they are on a real table.
    line.appendChild(
      isDouble(placed.tile)
        ? tileNode(placed.a, placed.b, 'v')
        : tileNode(placed.a, placed.b, 'h'),
    );
  }

  const right = document.createElement('span');
  right.className = 'end-marker';
  right.textContent = `end ${open.right}`;
  line.appendChild(right);
}

function movesForTile(tileId) {
  return legalMoves(game, HUMAN).filter((move) => move.tileId === tileId);
}

function renderHand() {
  const hand = el('hand');
  hand.innerHTML = '';
  const myTiles = game.hands[HUMAN];
  el('your-pips').textContent = `${totalPips(myTiles)} pips`;

  const myTurn = game.turn === HUMAN && game.phase === 'playing';

  for (const tile of myTiles) {
    const node = tileNode(tile.high, tile.low, 'v');
    const moves = myTurn ? movesForTile(tile.id) : [];

    if (moves.length > 0) {
      node.classList.add('tile--playable');
      node.addEventListener('click', () => onTileClick(tile.id));
    } else if (myTurn) {
      node.classList.add('tile--idle');
    }
    if (selected === tile.id) node.classList.add('tile--selected');

    hand.appendChild(node);
  }
}

function renderStatus() {
  const status = el('status');
  status.className = 'status';
  status.innerHTML = '';

  const text = document.createElement('span');
  if (message) {
    text.innerHTML = message;
  } else if (game.turn === HUMAN) {
    text.innerHTML = '<strong>Your turn.</strong>';
  } else if (game.turn !== null) {
    text.textContent = `${LABEL[game.turn]} is thinking…`;
  }
  status.appendChild(text);
}

function renderEndPicker() {
  const picker = el('endpick');
  if (!selected) {
    picker.hidden = true;
    return;
  }
  const open = ends(game);
  const moves = movesForTile(selected);
  picker.hidden = false;

  for (const end of ['left', 'right']) {
    const button = el(`pick-${end}`);
    const available = moves.some((move) => move.end === end);
    button.hidden = !available;
    button.textContent = `${end === 'left' ? 'Left' : 'Right'} end (${
      end === 'left' ? open.left : open.right
    })`;
  }
}

// ------------------------------------------------------------ interaction

function onTileClick(tileId) {
  const moves = movesForTile(tileId);
  if (moves.length === 0) return;

  if (moves.length === 1) {
    submit(HUMAN, tileId, moves[0].end);
    return;
  }
  // The tile fits both ends, and which one you pick matters — see STRATEGY.md
  // on cuadrar. Let the player decide.
  selected = tileId;
  render();
}

function submit(seat, tileId, end) {
  selected = null;
  const result = play(game, seat, tileId, end);
  message =
    seat === HUMAN
      ? `You played <strong>${tileId}</strong>.`
      : `${LABEL[seat]} played <strong>${tileId}</strong>.`;
  afterMove(result);
}

function submitPass(seat) {
  const result = pass(game, seat);
  message =
    seat === HUMAN
      ? 'You had nothing to play and <strong>passed</strong>.'
      : `${LABEL[seat]} <strong>passed</strong>.`;
  afterMove(result);
}

function afterMove(result) {
  render();
  scrollBoard();

  if (game.phase === 'playing') {
    scheduleNext();
  } else {
    showResult(result);
  }
}

function scheduleNext() {
  clearTimeout(timer);
  if (game.phase !== 'playing') return;

  const seat = game.turn;

  if (seat === HUMAN) {
    // A player with no legal tile must pass; do it for them after a beat so the
    // reason is visible rather than instant.
    if (legalMoves(game, HUMAN).length === 0) {
      timer = setTimeout(() => submitPass(HUMAN), BOT_PAUSE);
    }
    return;
  }

  timer = setTimeout(() => {
    const move = chooseMove(game, seat);
    if (move) submit(seat, move.tileId, move.end);
    else submitPass(seat);
  }, BOT_PAUSE);
}

function scrollBoard() {
  const scroller = el('board-scroll');
  scroller.scrollLeft = (scroller.scrollWidth - scroller.clientWidth) / 2;
}

// ---------------------------------------------------------------- results

function showResult(result) {
  const usTeam = teamOf(HUMAN);
  const weWon = result.winningTeam === usTeam;
  const overlay = el('overlay');

  let title;
  let body;

  if (result.type === 'domino') {
    const who = result.winningSeat === HUMAN ? 'You' : LABEL[result.winningSeat];
    title = weWon ? 'Hand won' : 'Hand lost';
    body = `${who} went out. ${
      weWon ? 'Your side' : 'Their side'
    } scores ${result.points} — the pips left in the other team's hands.`;
  } else if (result.type === 'blocked') {
    title = weWon ? 'Blocked — you win it' : 'Blocked — they win it';
    body = `Nobody could play. The lighter hand takes it, and ${
      weWon ? 'your side' : 'their side'
    } scores ${result.points}.`;
  } else {
    title = 'Blocked — dead heat';
    body = 'Both teams held exactly the same number of pips, so nobody scores.';
  }

  if (result.gameOver) {
    title = result.winningTeam === usTeam ? 'You win the match' : 'They win the match';
    body += ` Final score ${game.scores[usTeam]}–${game.scores[1 - usTeam]}.`;
  }

  el('overlay-title').textContent = title;
  el('overlay-body').textContent = body;

  el('overlay-pips').innerHTML = '';
  for (const [name, value] of [
    ['Us', result.pips[usTeam]],
    ['Them', result.pips[1 - usTeam]],
  ]) {
    const box = document.createElement('div');
    box.innerHTML = `${name} left<b>${value}</b>`;
    el('overlay-pips').appendChild(box);
  }

  el('overlay-button').textContent = result.gameOver ? 'New match' : 'Next hand';
  overlay.hidden = false;
}

function onOverlayButton() {
  el('overlay').hidden = true;

  if (game.phase === 'gameOver') {
    newGame();
    return;
  }

  startHand(game);
  announceOpening();
  render();
  scheduleNext();
}

function announceOpening() {
  const who = game.starter === HUMAN ? 'You' : LABEL[game.starter];
  message =
    game.handNumber === 1
      ? `${who} hold the double-six and must open with it.`
      : `${who} open this hand.`;
}

// ------------------------------------------------------------------- boot

function newGame() {
  clearTimeout(timer);
  selected = null;
  game = createGame({ targetScore: DEFAULT_TARGET });
  startHand(game);
  announceOpening();
  render();
  scheduleNext();
}

el('overlay-button').addEventListener('click', onOverlayButton);
el('pick-cancel').addEventListener('click', () => {
  selected = null;
  render();
});
for (const end of ['left', 'right']) {
  el(`pick-${end}`).addEventListener('click', () => {
    if (selected) submit(HUMAN, selected, end);
  });
}

newGame();
