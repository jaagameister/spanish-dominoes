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

No dependencies and no build step. From the project root:

```bash
python3 -m http.server 8000
```

Then open <http://localhost:8000/>.

(Opening `index.html` directly off the filesystem will not work — the code uses
ES modules, which browsers only load over HTTP.)

## Tests

The engine has no dependencies and is tested in the browser. With the server
running, open <http://localhost:8000/tests.html>.

## Layout

```
src/engine/tiles.js   the double-6 set: tiles, pips, shuffling — pure functions
src/engine/game.js    game state machine: deal, legal moves, passing, scoring
src/engine/bot.js     bot opponents
src/ui/app.js         rendering and interaction
```

The engine has no knowledge of the DOM, the bots, or the network. Everything
goes through its public API — `startHand`, `legalMoves`, `play`, `pass` — which
keeps the door open for real online multiplayer later: the same state machine
can run authoritatively on a server with moves arriving over the wire instead of
from bots.

## Rules sources

- [Partnership Dominoes — pagat.com](https://www.pagat.com/domino/line/partnership.html)
- [Caribbean Dominoes — pagat.com](https://www.pagat.com/domino/line/caribbean.html)
