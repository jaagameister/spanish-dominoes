# Strategy

The reference both humans and bots play from. The bots in `src/engine/bot.js`
score their moves against the principles below, and the section numbers here are
cited directly in that file's weights — so tuning a bot and teaching the game are
the same activity.

Most of what follows comes from the Spanish and Venezuelan tactical literature,
which is far deeper than anything written in English: the Federación Española de
Dominó training manual, and the tradition descending from Héctor Simosa Alarcón
("El Tigre de Carayaca"), whose 1957 *Ciencia y Arte en el Dominó* is the closest
thing this game has to a canonical text. Sources are listed at the end.

A warning that applies throughout: **this game's conventions are genuinely
contested.** Where schools disagree, §10 states which reading this
implementation adopts, and §12 records the alternatives.

---

## 0. The arithmetic

Learn these five numbers and most of the rest follows.

- **28 tiles, 168 pips.** Four hands therefore average **42 pips**, six per tile.
- **Each number appears on exactly 7 tiles** — but on **8 half-faces**, since the
  double contributes two. Many sources say "8 tiles"; they are wrong, and the
  confusion corrupts suit-exhaustion logic. Count *tiles* for exhaustion, *halves*
  for fast pip arithmetic.
- **The 7 tiles bearing number *n* total `7n + 21` pips** — 21 for blanks, 63 for
  sixes.
- **Hand classification:** heavy (*juego alto*) above 48 pips, medium 36–48, light
  (*juego bajo*) below 36. Decide your plan for the hand the moment you see it: a
  heavy hand wants to shed points, a light hand wants to hunt a block.
- **Break-even for a block is half the outstanding pips.** Your side must be
  *below* half of what is still in hands.

Useful priors: about 58% of hands contain at least one *falla* (a number you hold
none of), and roughly 9 in 10 contain a 3-or-4-tile suit. The typical hand is one
void, one or two doubles, and one suit worth developing.

---

## 1. Vocabulary

Spanish terms are standard at the table and worth knowing; they name concepts
English has no word for.

| Term | Meaning |
|---|---|
| **ficha**, **piedra** | tile |
| **palo**, **pinta** | a suit — that is, a number |
| **salida** | the opening lead; **salidor** / **mano** = the opener |
| **pie**, **postre** | the fourth player to act |
| **tapar** | to cover — play onto the number someone just opened |
| **matar** | to kill a suit by covering it |
| **paso** | a pass |
| **falla** | a number you hold none of; **semifalla** = exactly one |
| **doble**, **mula** | a double |
| **en pelo** | a double with no companion tiles |
| **acompañamiento** | the companion tiles of a suit you hold |
| **ahorcar un doble** | to "hang" a double — exhaust its suit so it can never be played |
| **violín** | five or more tiles of one suit |
| **cuadrar**, **doblar el juego** | to make **both open ends show the same number** |
| **firme**, **llave** | the last unplayed tile of a suit — guaranteed placement |
| **tranque**, **cierre** | a blocked hand |
| **pensada** | the deliberate pause, used as a signal (see §10) |
| **capicúa** | going out on a tile playable at either end |
| **el burro** | the 6-6 |
| **pollona** | a shutout |

---

## 2. The opening

**The rule: lead your highest double that has at least one companion tile of the
same suit.** If no double is accompanied, lead the mixed tile whose two numbers
give you the most companions in total.

The "accompanied" qualifier is the load-bearing part, and it is what the vague
English advice ("lead your longest suit") is groping at. Three reasons the double
beats the long suit:

1. Doubles are the hardest tiles to place and the only ones that can be *hung*.
   Shed your worst liability while you still have free choice.
2. A double lead **forces the next player to answer on a single number.** A mixed
   lead gives them two ends to choose from and tells you less.
3. It is an unambiguous statement to your partner: this is my suit, and I no
   longer hold its double.

Refinements:

- **Never lead a bare double.** Leading a double you cannot follow up creates an
  instant void and hands the table a suit you can't contest.
- **Two doubles sharing a companion (the *Almodóvar*):** lead the *mixed* tile
  common to both. Your partner can then deduce you hold both doubles.
- **With a *violín* (5+ of a suit), do not lead its double.** With five, lead
  outside the suit and develop it later; with six, lead the odd tile to conceal
  the strength. Only a seven-tile violín justifies leading the double.
- **Avoid leading 3-3.** Threes sit in the middle of the chain and tend to
  produce blocks — acceptable only when your hand is light and you want one.
- **All doubles bare?** Lead the highest, to shed the most points if the hand
  turns bad.
- **Score-dependent tiebreak:** ahead, lead the higher tile; behind, the lower.

**On the first hand of a match the 6-6 opening is forced, so it carries no
information at all.** Every convention that reads meaning into the opening is
suspended for that one lead — a point the tradition makes explicitly.

A Monte Carlo study of a million-plus simulated games found the opening choice
barely moves the win rate. Treat these as sound priors; the mid-game is where
games are decided.

---

## 3. The first round: who covers what

The four seats have different jobs on the opening round. Writing A for the
opener, then B, C (A's partner) and D in turn order:

- **B and D — the opponents — normally cover the opening** (*tapar la salida*),
  killing A's chosen number.
- **C — the opener's partner — normally does not cover.** C plays on the number
  *B* opened instead. The reasoning: A chose that suit deliberately and almost
  certainly holds more of it, so leave it alive for him and punish the
  opponent's number instead.

Documented exceptions:

- **C should cover** when the opening was the forced 6-6 (no information in it),
  when C holds three or more of B's suit and wants to seize it, or when not
  covering would leave C exposed on two suits.
- **D should not cover** when D holds three or more of the opening suit and can
  take it over by weight of numbers, or when D holds the *llave* joining both
  live suits and can deny the opener his next turn.

**Height convention:** if the opener led a low double, that implies he lacks the
higher ones. So the opponents should open suits *above* the opening value, and
the opener's partner should stay *below* it.

---

## 4. Counting and deduction

### The counter you must keep

For each of the seven numbers, track how many of its seven tiles are visible. Two
thresholds matter:

- **Six played** (or five played with the double still out) leaves one tile: the
  **firme**. Whoever holds it has guaranteed placement and controls whether the
  game closes.
- **Seven played** kills the number. If a dead number is showing at an end, that
  end is permanently closed. Both ends dead simultaneously is a *tranque*.

### Counting pips quickly

Two interchangeable methods:

- **Count what's played.** Because matched halves are equal, walk the chain
  counting *every other tile* (skip a whole tile when you land on a double), count
  only one end of the last tile, double the result, and subtract from 168. Fast
  early, when few tiles are down.
- **Count what's missing.** Work number by number from six down; there are eight
  half-faces of each. Faster late.

Then **halve the outstanding total.** That is your break-even for a block.

### Turning passes into certainty

A pass is not a hint — it is proof. A player who passes with ends showing *a* and
*b* holds **none of the 13 tiles** containing either. Accumulate these and hands
become solvable:

| Numbers a player is known to lack | Tiles they could still hold |
|---|---|
| 1 | 21 |
| 2 | 15 |
| 3 | 10 |
| 4 | 6 |
| 5 | 3 |

Four known voids leaves six candidate tiles. And if three players have passed on
a number, the fourth holds **every** unplayed tile of it.

Softer reads, probable rather than certain:

- A player who had the chance to place a double and played something else
  probably doesn't hold it.
- A player who covers their own lead when the other end was open is probably void
  on that other end.
- **Beware the forced play.** A player with only one legal move tells you nothing
  intentional — and a forced play is *more* confusing than a pass, because a pass
  at least publishes a void. If a partner's play makes no sense, assume they were
  forced before assuming they were signaling.

---

## 5. Doubles

**Doubles are liabilities.** A mixed tile plays on either of two numbers; a
double plays on one. It cannot be used to *cuadrar*, cannot kill a suit, and can
be **hung** — once the other six tiles of its number are down, it is dead weight
worth up to twelve points.

**Default: play doubles at the first opportunity, high ones especially.** Given a
choice between placing your double and opening a fresh suit, place the double.

**Hanging risk scales with companions,** and not monotonically:

| Companions of the double in hand | Risk of being hung |
|---|---|
| 0 (*en pelo*) | Low — you have no stake in the suit, but it's dead weight; unload it |
| 1 | Low to moderate |
| **2–3** | **Highest** — you're committed to the suit but don't control it |
| 4+ | Negligible — the suit can't be exhausted without you |

**Hold a double only for a concrete reason:**

1. **Guaranteed placement** — you hold both the double *and* the firme of its
   suit. Then it is a tempo reserve and a closing option, not a liability.
2. **Placing it would enable an opponent's block.**
3. **Your partner needs the tile you'd have to give up** to save him from a pass.

**Hunting their doubles.** Track the big ones by elimination: a player who passed
up a chance to place the 6-6 almost certainly doesn't have it. Once you've located
one in an opponent's hand, either hang it or block its exit — and if it's your
*partner's*, *cuadrar* to that number so he can drop it. Go double-hunting only
when you're confident on both counts; otherwise just race for points.

---

## 6. Cuadrar — making both ends match

Placing a tile so **both open ends show the same number** is the most powerful
single move in the game. Four distinct effects:

1. **It halves the next player's options** — one number to answer, not two.
2. **It guarantees your partner that number.** The single opponent between you
   cannot cover both ends in one turn. This is the mechanism behind the tradition's
   insistence that squaring for your partner is a duty.
3. **It manufactures a firme.** Square onto a number with five tiles already down
   and only two remain; one gets played by force, and the other becomes a firme.
   This is how you *create* the key to a block instead of waiting for one.
4. **It forces a pass** when squared onto a number you know the next opponent
   lacks.

Use it to rescue your partner's stranded big double, to pull a specific tile out
of an opponent's hand, or to force the pass. **Don't** square onto a number your
own side is short in — it turns around on you.

**Related: *pegar con llave*.** Open a number while *keeping* the tile that
bridges it to the other open end, denying the next player the square. Ends show 6
and 5; you play 5-4 while holding 6-4, so nobody can square to fours.

**And *pegar con falla*:** when forced to play into an opponent's suit, play the
tile of theirs you have the least accompaniment in, so they can't strip you of the
one you'll need later.

---

## 7. Feeding your partner, starving the opponents

The governing priority, stated as a proverb: **shut the opponents down before you
start handing gifts to your partner.** Blocking takes precedence over feeding.

Mechanisms, in rough order of power:

- ***Cuadrar*** onto a number an opponent has passed on — a forced pass, and your
  partner still gets the number.
- **Never reopen the number your partner passed on.** This is rule number one in
  every beginner list in the tradition. Cover it every time it appears.
- **Keep your last tile of your partner's dead number as insurance,** so you can
  always re-close that end for him rather than being forced to open it.
- **Kill the number played by the opponent who acts immediately before your
  partner** — that's the one applying pressure to him.
- **Don't introduce fresh suits while you have any alternative.** Every new number
  you open is an escape route.
- **"Closing the game" without blocking it:** work out which numbers would readmit
  an opponent's strong suit, and simply never let those appear at an end. If
  they're strong in fives and the played fives are 5-5, 5-4, 5-3, 5-2 and 5-0, then
  only a 6 or a 1 can bring fives back — so keep sixes and ones off the ends. This
  is the most mechanical rule in the literature and the easiest to automate.

Being starved is not the same as losing. A player who passes repeatedly can still
be on the winning side; the tradition has a proverb specifically to reassure them.

---

## 8. The tranque — blocking

A block needs all seven tiles of a number played, that number showing at **both**
ends, and every player still holding at least one tile.

**The player who closes does not win.** The side with fewer unplayed pips does. In
our rules a tie scores nothing at all, which makes a marginal block worthless
rather than merely risky.

### Before you commit

```
outstanding = 168 − pips already on the table
threshold   = outstanding / 2
close only if (your pips + your estimate of partner's) < threshold
```

Estimate your partner from his passes (each pass eliminates 13 tiles), from the
suits he's marked, from tiles he *failed* to send you, and — with nothing better —
from his tile count times six.

### When to close

- **Your hand is light and the outstanding total is heavy.** The classic case.
- **You've located a big double opposite.** A hung 6-6 is twelve free points.
- **You're behind on the match.** A block caps the opponents' upside; it's the
  standard catch-up tool.
- **The hand is already lost.** Closing to force a tie, or to shed maximum points,
  beats playing it out.
- **Don't close when you're winning the race.** If your side can go out, don't
  trade a certainty for a pip count.

### Setting one up

1. Watch for a number **nobody is answering** — that's a number nobody holds.
2. Drive a suit toward exhaustion while holding its firme, squaring onto it
   repeatedly to make the opponents burn their copies.
3. Make the *other* end a number your reads say is also dead.
4. Run the count.
5. Only then drop the firme.

**Watch for the forced close against you.** If you hold a firme and both ends
drift onto its suit, you'll be *compelled* to close whether the count favors you
or not. Count ahead; if it's bad, spend the firme early at a moment you choose.

---

## 9. The endgame

From roughly the sixth tile, the objective function changes. Up to that point you
play suit development. After it you play two questions: **is a block good for us
right now**, and **can our side actually go out?** They often conflict, and the
count decides.

- **The firme is the endgame asset.** Holding it means you can never be passed
  out, everyone else is confined to the other end, and you choose the moment to
  close. Holding both a suit's double and its firme is close to controlling the
  hand.
- **Keep your last two tiles on two different live numbers.** Two tiles of the
  same dying number is how you get passed out and eat the count.
- **Guard your partner's exit.** With him down to one or two tiles and a known
  void, keep the tile that re-covers it. Don't open his dead number for a marginal
  gain.
- **Don't hand over a square.** Late in the hand, a *cuadre* by the opponent
  before your partner is often decisive — hold the bridging tile when you can.

---

## 10. The convention card

Partners may not talk. Everything below is communicated by tile choice alone, and
this section is the **specific set of conventions this implementation uses** —
both what the bots emit and what they read. Sources genuinely conflict here (§12);
these are our house rules.

**1. Your opening names your suit.**
Lead your highest accompanied double. Your partner reads that as *"this is my
number and I no longer hold its double"* and keeps it alive rather than covering
it. **Suspended on the forced 6-6 opening** — that lead means nothing.

**2. Repetition means strength.**
Playing the same number again says *"I have more of these — keep feeding it."*
Repeat your partner's number whenever you genuinely hold more.

**3. Non-repetition means weakness.**
Declining to repeat a number your partner opened says *"I have none."* This is the
clearest negative signal in the game, and it works precisely because convention 2
is followed so reliably. The corollary is a duty: **never repeat a suit you can't
back up** — you will mislead your partner into building on nothing.

**4. Cuadrar is an offer.**
Setting both ends to the same number is an explicit gift: the opponent between you
cannot take it away. Squaring onto a high number is usually read as *"drop your big
double here."*

**5. A high double played early is a request.**
It fixes both ends to one number and says *"this is my suit, feed it."*

**6. A pass is fact, and it creates obligations.**
It proves the passer holds neither open number. Your partner's pass obliges you
to (a) stop opening that number, (b) cover it when it appears, and (c) hold your
last tile of it as a lock.

**7. First-round roles** are as in §3: opponents cover the opening, the opener's
partner does not.

**8. Height:** after the opening, opponents open suits *above* the opening value;
the opener's partner stays *below* it.

### What we deliberately do not use

**Timing (*la pensada*).** In the live tradition this is the most formalized
signal of all — the maxim holds that the pause is the only legitimate signal in
dominoes. We omit it, for two reasons. First, the schools flatly contradict each
other: in the *clásico* system a pause means "I hold more of this suit," while in
the *moderno* system it means the opposite — that the suit is unfavorable to you.
Two strangers partnering can and do read each other backwards. Second, a bot
cannot pause meaningfully; simulated hesitation would be theater, and worse, a
tell the player would learn to read as a bug rather than a signal.

**Physical signals** — gestures, tile orientation, tapping, facial reactions — are
cheating at every level that writes rules down, and tournament regulations go as
far as specifying where players must keep their hands. Not modeled.

**Note:** the game surfaces known voids in the interface. That is not a cheat and
not an assist — a pass is public information that every competent player at the
table is already tracking. The display just spares you the bookkeeping.

---

## 11. How the bots use this

`src/engine/bot.js` scores every legal move as a weighted sum of features, each
one corresponding to a principle above. Priority ordering, highest first:

1. **Go out if you can.** Ends the hand and banks the opponents' pips.
2. **Cover the number your partner passed on;** never open it. (§7)
3. **Force an opponent pass** by squaring onto a number they've failed. (§6, §7)
4. **Don't spend a firme** without a reason — it's endgame control. (§8)
5. **Play doubles early,** weighted by hanging risk: worst at two or three
   companions, harmless at four or more. (§5)
6. **Cuadrar** when it forces a pass, guarantees your partner a number, or
   manufactures a firme. (§6)
7. **Play from your longest suit** — the single best-performing policy in the
   Monte Carlo study, ahead of every point-management rule. (§4)
8. **Don't open the entry numbers of an opponent's strong suit.** (§7)
9. **Avoid creating a void,** and never create two at once. (§0)
10. **Shed pips — conditionally.** Weighted up when the hand is heavy or the
    match score is behind, down otherwise. Naive heavy-tile dumping ranked *second
    worst* of six policies tested; it is a tiebreaker, not a strategy. (§12)

Difficulty is implemented by widening the band of moves the bot will accept as
good enough, so a weak bot makes *plausible* mistakes — a defensible-looking
second-best move — rather than random ones.

---

## 12. Where the sources disagree

Worth knowing, because you will meet players who were taught the other way.

1. **"Lead your longest suit" vs. "lead your highest accompanied double."** Not
   compatible: the Spanish rule says lead the double even when another suit is
   longer. The English-language advice is a crude approximation of it.
2. **Doubles early or held?** A well-known proverb mocks the player who plays a
   double first. The federation manual and the Cuban tip sheets say the opposite.
   The reconciliation most sources land on: high doubles early, low doubles kept
   as blocking resources.
3. **Heavy-tile dumping.** Recommended by nearly every casual English guide;
   ranked fifth of six policies in simulation, and subordinated to suit control
   throughout the Spanish literature. Score-conditional, not unconditional.
4. **The *pensada*.** Three mutually contradictory schools (*clásico*, *moderno*,
   *combinado*), with the combined system explicitly requiring partners to agree
   in advance which reading governs. Federation tournament rules simultaneously
   celebrate the pause as the only honorable signal and fence in everything
   adjacent to it.
5. **Which end you play on.** Widely assumed to carry a coded meaning; no source
   documents one. What exists is positional (cover vs. respect the opening) and
   tactical (*cuadrar*), not a left/right code.
6. **"Each number appears 8 times."** Common and wrong — 7 tiles, 8 half-faces.
7. **Blocked-hand scoring varies by region** and changes how much a block is
   worth: Latin tables score only the losers' pips (our rule), the Spanish
   federation sums all four hands, Caribbean club play scores 1–2 points a hand.
8. **Signaling ethics vary sharply by region.** Haitian tables permit explicit
   hand signals, with standard meanings for a fist, a finger drawn across the
   table, and an open palm. Jamaican rules ban gestures but tolerate hesitation.
   Tournament play bans essentially everything.

---

## Sources

**Primary**

- [Federación Española de Dominó — Formación Dominó 2023 (PDF)](https://fedomino.com/wp-content/uploads/2023/12/FORMACION-DOMINO-2023.pdf) — the richest single source
- [Dominó Arte o Ciencia](https://sites.google.com/site/dominoarteociencia/) — the Simosa tradition, especially
  [La salida](https://sites.google.com/site/dominoarteociencia/anuncio/lasalida) ·
  [El cierre](https://sites.google.com/site/dominoarteociencia/anuncio/elcierreolatranca) ·
  [Deducción de fichas](https://sites.google.com/site/dominoarteociencia/anuncio/deducciondefichas) ·
  [Los dobles](https://sites.google.com/site/dominoarteociencia/anuncio/entradasintitulo-1) ·
  [Doblar el juego](https://sites.google.com/site/dominoarteociencia/Principiante/doblareljuego) ·
  [28 Consejos](https://sites.google.com/site/dominoarteociencia/anuncio/28consejosparajugaraldominoporparejas) ·
  [Principios y Sistemas](https://sites.google.com/site/dominoarteociencia/cienciayarteeneldomino/principiosysistemasdeldominoporparejas) ·
  [Técnicas para contar rápido](https://sites.google.com/site/dominoarteociencia/anuncio/tecnicasparacontarrapido) ·
  [Malas artes](https://sites.google.com/site/dominoarteociencia/anuncio/malasartes)
- [Simulación de Monte Carlo para el juego de dominó (Scielo México, 2020)](https://www.scielo.org.mx/scielo.php?script=sci_arttext&pid=S1405-55462020000401369) — the policy comparison

**Rules and regional practice**

- [Pagat — Partnership Dominoes](https://www.pagat.com/domino/line/partnership.html) · [Caribbean Dominoes](https://www.pagat.com/domino/line/caribbean.html)
- [FichaFlow](https://fichaflow.com/learn) — Dominican practice and terminology
- [Cubalite — 10 consejos](https://cubalite.com/10-consejos-para-jugar-al-domino-como-un-cubano-experto/)
- [El Mundo del Dominó — La pensada](http://elmundodeldomino.blogspot.com/2009/07/la-pensada-en-el-domino.html) — the competing timing schools
- [USA Domino Federation rules](https://usadomino.com/r/) · [Reglamento FED (PDF)](https://fmurdomino.com/wp-content/uploads/2023/06/reglamentodeljuegoycompeticiones.1.pdf)
