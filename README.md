# Partner Dominoes

A browser implementation of **Partnership Dominoes** — the 2v2 block game that
Pagat describes as "the most popular dominoes game in Spain and Latin America."
It goes by a lot of names depending on who taught you: Spanish dominoes, Latin
dominoes, Dominican or Puerto Rican dominoes. Cuban dominoes is the same game
played with a double-9 set.

Play against bots, no install, no build step.

## Rules

The ruleset here is the **Venezuelan** variation, played to 100.

### Setup

- Standard **double-6 set**: 28 tiles.
- **Four players in two fixed partnerships.** Seats 0 and 2 are Team 1; seats 1
  and 3 are Team 2. Partners sit facing each other, so play alternates between
  the teams.
- **All 28 tiles are dealt** — seven to each player. There is no boneyard and
  nothing is held back, so every tile in the set is in somebody's hand.
- Turn order runs to the **left**.

### Play

- On the **first hand of a match**, whoever holds the **[6-6] opens, and must
  lead it**.
- On **every later hand**, the opening passes **one seat to the left**, and the
  opener may lead any tile they choose.
- Tiles form a single line, matching end to end. Doubles are laid crosswise by
  convention; it does not change how they play.
- **You must play if you legally can.** A player with no matching tile **passes**
  — traditionally by knocking on the table.

### Ending a hand

A hand ends one of two ways:

- **Domino** — a player sheds their last tile. Their team wins the hand.
- **Blocked** — all four players pass in succession with tiles still in hand.
  The team with the **lower pip total** wins. If the two teams hold exactly the
  same number of pips, **nobody scores** and the hand is a wash.

### Scoring

The winning team scores the **pip total of the losing team's unplayed tiles**.
Your own team's tiles never count against you or for you.

**First team to 100 points wins the match.**

## Strategy

See [STRATEGY.md](STRATEGY.md) for opening theory, counting, blocking tactics,
and the partner-signaling conventions. The bots play from the same document, so
it doubles as a description of how they think.

## Running it

Node 20 or newer, and no dependencies at all — there is nothing to `npm install`.

```bash
npm start
```

Then open <http://localhost:8000/>.

## Playing with other people

Open a table and you get a four-character code, an invite link, and a QR code to
point a phone at. Any seat still empty when you start is filled by a bot, so a
table works with one, two, three or four people.

**People who arrive together are partnered by default.** Seats alternate between
the teams, so seating each newcomer in the next free chair would make the second
person at the table an opponent — almost never what anyone wants. The second
human is seated across from the first instead, and the third and fourth take the
opposing pair. The host can rearrange anyone with the arrows in the waiting room
before play begins.

**A player partnered by a bot gets to see what it did.** When your partner is a
bot, the table holds after each of its moves until you press Proceed — otherwise
three more moves land on top of it before you have taken it in. Two humans
playing as partners never see this, because then the bots are partnering each
other. If the waiting player disappears, the table carries on by itself after
ninety seconds rather than stranding everyone.

The server listens on every interface, so anyone on the same network can join at
`http://<your-lan-ip>:8000`. Reaching it from outside your network needs a
tunnel or real hosting; nothing here assumes either.

Playing on your own is the same thing with all three other seats taken by bots —
there is no separate single-player mode, and so no second copy of the rules.

## Tests

```bash
npm test
```

31 tests: the engine, and the server's API and redaction guarantees. The engine
cases live in `src/engine/tests.js` and are driven by both `node --test` and the
browser page at <http://localhost:8000/tests.html>, so the two runners can never
disagree about what passes.

## Layout

```
src/engine/tiles.js   the double-6 set: tiles, pips, shuffling — pure functions
src/engine/game.js    game state machine: deal, legal moves, passing, scoring
src/engine/bot.js     bot opponents, and the reasons behind each move
src/ui/app.js         rendering and interaction — a pure view layer
server/server.js      HTTP, static files, JSON API, one SSE stream per player
server/rooms.js       rooms, seating, bots, turn scheduling
server/protocol.js    what each player is allowed to see
```

Two boundaries hold this together.

**The engine knows nothing about the DOM, the bots, or the network.** Everything
goes through `startHand`, `legalMoves`, `play` and `pass`, which is why the same
files run in the browser and authoritatively on the server.

**`server/protocol.js` is the only code permitted to read `game.hands`.** Every
message to every client passes through it, so no player is ever sent another
player's tiles. Keeping that in one function is what makes the guarantee
checkable rather than merely intended — and it is tested directly.

## Rules sources

- [Partnership Dominoes — pagat.com](https://www.pagat.com/domino/line/partnership.html)
- [Caribbean Dominoes — pagat.com](https://www.pagat.com/domino/line/caribbean.html)
