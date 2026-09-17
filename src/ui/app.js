// Interface.
//
// The browser is a pure view layer: it renders whatever state the server sends
// and posts moves back. It imports nothing from src/engine — playing solo is
// just a table whose other three seats are bots, so there is exactly one code
// path and no second copy of the rules to drift out of sync.

import { toSvg } from './qr.js';

const LABEL_STORAGE = 'partner-dominoes/session';

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

const END_TEXT = {
  open: 'to open',
  left: 'on the left end',
  right: 'on the right end',
};

const el = (id) => document.getElementById(id);

let session = null; // { code, token, seat }
let view = null;
let selected = null; // tile id waiting on a choice of end
let stream = null;
let overlayDismissed = false;

// ------------------------------------------------------------------- state

function saveSession(next) {
  session = next;
  try {
    localStorage.setItem(LABEL_STORAGE, JSON.stringify(next));
  } catch {
    // Private browsing; the session simply won't survive a refresh.
  }
}

function loadSession() {
  try {
    const raw = localStorage.getItem(LABEL_STORAGE);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function clearSession() {
  session = null;
  try {
    localStorage.removeItem(LABEL_STORAGE);
  } catch {
    /* ignore */
  }
}

async function api(path, body) {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });
  return res.json();
}

// -------------------------------------------------------------------- seats

/**
 * Where each seat sits on screen, relative to the viewer: you at the bottom,
 * your partner across, opponents on the flanks.
 */
function positions() {
  const me = view.seat;
  return {
    west: (me + 1) % 4,
    north: (me + 2) % 4,
    east: (me + 3) % 4,
  };
}

function nameOf(seat) {
  const player = view.players[seat];
  if (!player) return `Seat ${seat}`;
  return seat === view.seat ? 'You' : player.name;
}

// -------------------------------------------------------------------- tiles

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

function tileNode(first, second, orientation) {
  const node = document.createElement('div');
  node.className = `tile tile--${orientation}`;
  node.append(half(first), half(second));
  return node;
}

// ------------------------------------------------------------------ screens

function show(screen) {
  for (const id of ['screen-lobby', 'screen-wait', 'screen-table']) {
    el(id).hidden = id !== screen;
  }
}

function render() {
  if (!view) return;

  if (view.status === 'lobby') {
    show('screen-wait');
    renderWaitingRoom();
    return;
  }

  show('screen-table');
  renderTable();
}

// ------------------------------------------------------------ waiting room

function renderWaitingRoom() {
  el('room-code').textContent = view.code;

  const url = inviteUrl();
  el('invite-url').textContent = url;
  renderInviteCode(url);

  const host = view.seat === view.hostSeat;

  const roster = el('roster');
  roster.innerHTML = '';
  view.players.forEach((player, seat) => {
    const item = document.createElement('li');
    const filled = player.kind === 'human';
    item.className = filled ? 'roster__seat roster__seat--taken' : 'roster__seat';

    const who = document.createElement('span');
    who.className = 'roster__who';
    who.textContent = filled ? nameOf(seat) : 'Empty — a bot will sit here';

    const tag = document.createElement('span');
    tag.className = 'roster__tag';
    // Partners face each other, so the seat you take decides your team.
    tag.textContent = seat % 2 === view.seat % 2 ? 'Your team' : 'Other team';

    item.append(who, tag);

    // Only the host rearranges, and only seating order matters — swapping with
    // the seat above or below reaches any arrangement.
    if (host) {
      const controls = document.createElement('span');
      controls.className = 'roster__move';
      for (const [label, target] of [
        ['↑', seat - 1],
        ['↓', seat + 1],
      ]) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'ghost tiny';
        button.textContent = label;
        button.disabled = target < 0 || target > 3;
        button.title = `Swap with seat ${target + 1}`;
        button.addEventListener('click', () => swapSeats(seat, target));
        controls.appendChild(button);
      }
      item.appendChild(controls);
    }

    roster.appendChild(item);
  });

  el('roster-hint').textContent = host
    ? 'Partners sit across from each other — seats 1 and 3 are one team, 2 and 4 the other. Use the arrows to rearrange. Any seat still empty when you start is filled by a bot.'
    : 'Any seat still empty when the host starts is filled by a bot.';

  el('btn-start').hidden = !host;
  el('btn-start').textContent =
    view.players.filter((p) => p.kind === 'human').length > 1
      ? 'Start playing'
      : 'Start with bots';
}

/**
 * The link to hand someone else. The host is nearly always on localhost, which
 * would send a phone to its own loopback, so prefer the LAN origin the server
 * reports whenever this page is being viewed locally.
 */
let renderedInvite = null;

/** Redraw the QR only when the link actually changes — it is not free. */
function renderInviteCode(url) {
  if (renderedInvite === url) return;
  renderedInvite = url;
  try {
    el('qr').innerHTML = toSvg(url, { dark: '#101815', light: '#f2efe4' });
  } catch (error) {
    // A link too long to encode should cost the table its QR, nothing more.
    el('qr').innerHTML = '';
    console.warn('could not render the invite QR:', error.message);
  }
}

function inviteUrl() {
  const local = ['localhost', '127.0.0.1', '::1', '[::1]'].includes(
    location.hostname,
  );
  const origin = local && view.inviteOrigin ? view.inviteOrigin : location.origin;
  return `${origin}/?code=${view.code}`;
}

// ------------------------------------------------------------------- table

function renderTable() {
  const usTeam = view.seat % 2;
  el('score-us').textContent = view.scores[usTeam];
  el('score-them').textContent = view.scores[1 - usTeam];
  el('target').textContent = view.targetScore;
  el('hand-number').textContent = `Hand ${view.handNumber}`;

  renderSeats();
  renderLine();
  renderHand();
  renderStatus();
  renderEndPicker();
  renderOverlay();
}

function renderSeats() {
  const where = positions();
  for (const [side, seat] of Object.entries(where)) {
    const panel = el(`seat-${side}`);
    panel.className = `seat seat--${side}`;
    if (seat === (view.seat + 2) % 4) panel.classList.add('seat--partner');
    if (view.turn === seat) panel.classList.add('seat--active');
    panel.innerHTML = '';

    const player = view.players[seat];

    const name = document.createElement('div');
    name.className = 'seat__name';
    name.textContent =
      seat === (view.seat + 2) % 4 ? `${player.name} — partner` : player.name;

    // Worth knowing at a glance who at the table is a person.
    if (player.kind === 'bot') {
      const tag = document.createElement('span');
      tag.className = 'seat__bot';
      tag.textContent = 'bot';
      name.appendChild(tag);
    }

    const count = document.createElement('div');
    count.className = 'seat__count';
    for (let i = 0; i < player.tiles; i++) {
      const back = document.createElement('span');
      back.className = 'back';
      count.appendChild(back);
    }

    const meta = document.createElement('div');
    meta.className = 'seat__meta';
    meta.textContent = `${player.tiles} tile${player.tiles === 1 ? '' : 's'}`;
    if (player.kind === 'human' && !player.connected) {
      meta.textContent += ' · offline';
    }

    panel.append(name, count, meta);

    // A pass is public at a real table, so showing it is bookkeeping, not help.
    if (player.voids.length > 0) {
      const row = document.createElement('div');
      row.className = 'seat__voids';
      row.append('void in');
      for (const value of player.voids) {
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
  el('board-empty').hidden = view.line.length > 0;

  el('ends').hidden = !view.ends;
  if (!view.ends) return;
  el('end-left').textContent = view.ends.left;
  el('end-right').textContent = view.ends.right;

  const left = document.createElement('span');
  left.className = 'end-marker';
  left.textContent = `end ${view.ends.left}`;
  line.appendChild(left);

  for (const placed of view.line) {
    // Doubles are laid crosswise, as on a real table.
    line.appendChild(tileNode(placed.a, placed.b, placed.double ? 'v' : 'h'));
  }

  const right = document.createElement('span');
  right.className = 'end-marker';
  right.textContent = `end ${view.ends.right}`;
  line.appendChild(right);

  const scroller = el('board-scroll');
  scroller.scrollLeft = (scroller.scrollWidth - scroller.clientWidth) / 2;
}

function movesForTile(tileId) {
  return view.legalMoves.filter((move) => move.tileId === tileId);
}

function renderHand() {
  const hand = el('hand');
  hand.innerHTML = '';

  const pips = view.hand.reduce((sum, t) => sum + t.high + t.low, 0);
  el('your-pips').textContent = `${pips} pips`;

  const me = view.players[view.seat];
  el('your-name').textContent = me ? `${me.name} — your hand` : 'Your hand';

  const myTurn = view.turn === view.seat && view.phase === 'playing';

  for (const tile of view.hand) {
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
  const text = el('status-text');
  const waitingOnMe = view.pause?.seat === view.seat;

  status.classList.toggle('status--waiting', Boolean(waitingOnMe));
  el('btn-proceed').hidden = !waitingOnMe;

  if (waitingOnMe) {
    // The table is held so this player can take in what their partner did.
    text.innerHTML = `${escape(view.message ?? '')} <strong>Your partner's move.</strong>`;
  } else if (view.pause) {
    text.textContent = `${nameOf(view.pause.seat)} is catching up…`;
  } else if (view.phase === 'playing' && view.turn === view.seat) {
    text.innerHTML =
      view.legalMoves.length === 0
        ? 'Nothing you can play — you must <strong>pass</strong>.'
        : '<strong>Your turn.</strong>';
  } else {
    text.textContent = view.message ?? '';
  }
}

function escape(value) {
  const node = document.createElement('span');
  node.textContent = value;
  return node.innerHTML;
}

function renderEndPicker() {
  const picker = el('endpick');
  if (!selected || !view.ends) {
    picker.hidden = true;
    return;
  }
  const moves = movesForTile(selected);
  picker.hidden = false;

  for (const end of ['left', 'right']) {
    const button = el(`pick-${end}`);
    button.hidden = !moves.some((move) => move.end === end);
    button.textContent = `${end === 'left' ? 'Left' : 'Right'} end (${view.ends[end]})`;
  }
}

// -------------------------------------------------------------- interaction

function onTileClick(tileId) {
  const moves = movesForTile(tileId);
  if (moves.length === 0) return;

  if (moves.length === 1) {
    play(tileId, moves[0].end);
    return;
  }
  // The tile fits both ends, and which one matters — see STRATEGY.md on
  // cuadrar. Let the player choose.
  selected = tileId;
  render();
}

async function play(tileId, end) {
  selected = null;
  const result = await api(`/api/rooms/${session.code}/action`, {
    token: session.token,
    type: 'play',
    tileId,
    end,
  });
  if (result.error) flash(result.error);
}

// ------------------------------------------------------------------ results

function renderOverlay() {
  const overlay = el('overlay');
  const over = view.phase === 'handOver' || view.phase === 'gameOver';

  if (!over || overlayDismissed) {
    overlay.hidden = true;
    return;
  }

  const result = view.handResult;
  if (!result) return;

  const usTeam = view.seat % 2;
  const weWon = result.winningTeam === usTeam;

  let title;
  let body;

  if (result.type === 'domino') {
    const who = nameOf(result.winningSeat);
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

  if (view.phase === 'gameOver') {
    title = weWon ? 'You win the match' : 'They win the match';
    body += ` Final score ${view.scores[usTeam]}–${view.scores[1 - usTeam]}.`;
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

  const finished = view.phase === 'gameOver';
  el('overlay-button').textContent = finished ? 'Leave the table' : 'Deal the next hand';
  el('overlay-countdown').textContent = finished
    ? ''
    : 'The next hand deals on its own shortly.';
  overlay.hidden = false;
}

async function onOverlayButton() {
  if (view.phase === 'gameOver') {
    leaveTable();
    return;
  }
  overlayDismissed = true;
  el('overlay').hidden = true;
  const result = await api(`/api/rooms/${session.code}/ready`, { token: session.token });
  if (result.error) flash(result.error);
}

// ------------------------------------------------------------------- review

function seatClass(seat) {
  if (seat === view.seat) return 'move--you';
  return seat === (view.seat + 2) % 4 ? 'move--partner' : 'move--opponent';
}

function describePass(open) {
  if (!open) return 'passed';
  const [left, right] = open;
  // Both ends often show the same number, and "no 2 and no 2" reads badly.
  return left === right
    ? `passed — held no ${left}`
    : `passed — held no ${left} and no ${right}`;
}

function renderReview() {
  const list = el('review-list');
  list.innerHTML = '';

  view.log.forEach((entry, index) => {
    const item = document.createElement('li');
    item.className = `move ${seatClass(entry.seat)}`;

    const head = document.createElement('div');
    head.className = 'move__head';

    const who = document.createElement('span');
    who.className = 'move__seat';
    who.textContent = `${index + 1}. ${nameOf(entry.seat)}`;

    const what = document.createElement('span');
    what.className = 'move__what';
    what.textContent =
      entry.type === 'pass'
        ? describePass(entry.ends)
        : `played ${entry.tileId} ${END_TEXT[entry.end]}`;

    head.append(who, what);

    if (entry.explanation?.forced) {
      const tag = document.createElement('span');
      tag.className = 'move__forced';
      tag.textContent = 'forced';
      head.appendChild(tag);
    }

    item.appendChild(head);

    if (entry.explanation?.forced) {
      const note = document.createElement('p');
      note.className = 'move__alt';
      note.textContent = `${entry.explanation.onlyTile} was the only tile that would go down.`;
      item.appendChild(note);
      list.appendChild(item);
      return;
    }

    const reasons = entry.explanation?.reasons ?? [];
    if (reasons.length > 0) {
      const ul = document.createElement('ul');
      ul.className = 'move__reasons';
      // Heaviest considerations first — that is what drove the choice.
      for (const reason of [...reasons].sort(
        (a, b) => Math.abs(b.value) - Math.abs(a.value),
      )) {
        const li = document.createElement('li');
        const weight = document.createElement('span');
        weight.className = `weight ${reason.value > 0 ? 'weight--plus' : 'weight--minus'}`;
        weight.textContent = reason.value > 0 ? `+${reason.value}` : `${reason.value}`;
        const text = document.createElement('span');
        text.textContent = reason.text;
        li.append(weight, text);
        ul.appendChild(li);
      }
      item.appendChild(ul);
    }

    const runnerUp = entry.explanation?.runnerUp;
    if (runnerUp) {
      const alt = document.createElement('p');
      alt.className = 'move__alt';
      const mine = entry.explanation.score;
      const theirs = runnerUp.score;
      const other = `${runnerUp.move.tileId} ${END_TEXT[runnerUp.move.end]}`;
      alt.textContent =
        Math.abs(mine - theirs) < 0.05
          ? `Rated identically to ${other} — the choice was arbitrary.`
          : `Preferred over ${other} (${mine.toFixed(1)} vs ${theirs.toFixed(1)}).`;
      item.appendChild(alt);
    }

    list.appendChild(item);
  });
}

// ---------------------------------------------------------------- streaming

function connect() {
  stream?.close();
  stream = new EventSource(
    `/api/rooms/${session.code}/stream?token=${encodeURIComponent(session.token)}`,
  );

  stream.onmessage = (event) => {
    el('disconnected').hidden = true;
    const next = JSON.parse(event.data);

    // A fresh hand clears any overlay the player dismissed on the last one.
    if (view && next.handNumber !== view.handNumber) overlayDismissed = false;

    view = next;
    render();
  };

  stream.onerror = () => {
    // EventSource retries on its own; just say so.
    el('disconnected').hidden = false;
  };
}

function leaveTable() {
  stream?.close();
  stream = null;
  view = null;
  clearSession();
  el('overlay').hidden = true;
  show('screen-lobby');
}

// -------------------------------------------------------------------- lobby

function flash(message, target = 'lobby-error') {
  const node = el(target);
  node.textContent = message;
  node.hidden = false;
  setTimeout(() => {
    node.hidden = true;
  }, 4000);
}

/** The typed name, or null when they have not given one. */
function playerName() {
  return el('name').value.trim() || null;
}

function requireName() {
  const name = playerName();
  if (!name) {
    flash('Tell us your name first — the others need to know who they are playing.');
    el('name').focus();
  }
  return name;
}

async function openTable({ solo }) {
  const name = requireName();
  if (!name) return;

  const result = await api('/api/rooms', { name });
  if (result.error) return flash(result.error);

  saveSession({ code: result.code, token: result.token, seat: result.seat });
  connect();

  if (solo) {
    const started = await api(`/api/rooms/${result.code}/start`, { token: result.token });
    if (started.error) flash(started.error);
  }
}

async function joinTable(code) {
  const name = requireName();
  if (!name) return;

  const result = await api(`/api/rooms/${code.toUpperCase()}/join`, { name });
  if (result.error) return flash(result.error);

  saveSession({ code: result.code, token: result.token, seat: result.seat });
  connect();
}

async function swapSeats(from, to) {
  const result = await api(`/api/rooms/${session.code}/arrange`, {
    token: session.token,
    from,
    to,
  });
  if (result.error) flash(result.error, 'wait-error');
}

// --------------------------------------------------------------------- boot

el('btn-solo').addEventListener('click', () => openTable({ solo: true }));
el('btn-create').addEventListener('click', () => openTable({ solo: false }));

el('join-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const code = el('join-code').value.trim();
  if (code.length === 4) joinTable(code);
  else flash('A table code is four characters.');
});

el('btn-start').addEventListener('click', async () => {
  const result = await api(`/api/rooms/${session.code}/start`, { token: session.token });
  if (result.error) flash(result.error, 'wait-error');
});

el('btn-copy').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(inviteUrl());
    el('btn-copy').textContent = 'Link copied';
    setTimeout(() => {
      el('btn-copy').textContent = 'Copy the invite link';
    }, 2000);
  } catch {
    flash('Copy failed — the link is written below.', 'wait-error');
  }
});

el('btn-proceed').addEventListener('click', async () => {
  el('btn-proceed').disabled = true;
  const result = await api(`/api/rooms/${session.code}/proceed`, {
    token: session.token,
  });
  el('btn-proceed').disabled = false;
  if (result.error) flash(result.error);
});

el('overlay-button').addEventListener('click', onOverlayButton);
el('overlay-review').addEventListener('click', () => {
  renderReview();
  el('review').hidden = false;
});
el('review-close').addEventListener('click', () => {
  el('review').hidden = true;
});
el('pick-cancel').addEventListener('click', () => {
  selected = null;
  render();
});
for (const end of ['left', 'right']) {
  el(`pick-${end}`).addEventListener('click', () => {
    if (selected) play(selected, end);
  });
}

// An invite link carries the code; drop it into the join box.
const invited = new URLSearchParams(location.search).get('code');
if (invited) el('join-code').value = invited.toUpperCase().slice(0, 4);

// Rejoin whatever table this browser was last sitting at.
const saved = loadSession();
if (saved?.code && saved?.token) {
  session = saved;
  connect();
} else {
  show('screen-lobby');
}
