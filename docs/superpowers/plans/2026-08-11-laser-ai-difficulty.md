# Laser AI Difficulty Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add selectable easy, normal, and hard computer opponents, with normal playing aggressively and hard combining attack pressure with one-reply safety search.

**Architecture:** Keep the existing rules, move generation, laser simulation, and `aiChoose` entry point in `laser-game.js`. Add small difficulty-specific scoring parameters and reuse one evaluation pipeline; expose an underscored debug surface only for dependency-free Node regression tests. Add one cycling difficulty button to the existing action area.

**Tech Stack:** ES5-compatible JavaScript, Canvas 2D, WeChat Mini Game runtime, Node.js built-in `assert`.

## Global Constraints

- Default difficulty is `normal`.
- Easy remains defensive and shallow; normal is aggressive; hard is the strongest balanced mode.
- Every level must reject self-killing laser actions when a safe legal action exists.
- Hard searches exactly one complete opponent reply, including the opponent choosing to fire without moving.
- No third-party dependencies, settings page, or separate AI implementation per difficulty.
- Restarting or changing layout preserves the selected difficulty.

---

### Task 1: Regression Harness and Three-Level AI Selection

**Files:**
- Modify: `games/laser/laser-game.js:42-323,1967-1993`
- Create: `tests/laser-ai.test.js`

**Interfaces:**
- Consumes: existing `generateActions(pieces, player, opts)`, `applyAction(pieces, act)`, `resolveTurn(pieces, player, act)`, and `simulateLaser(pieces, laser)`.
- Produces: `aiChoose(pieces, aiPlayer, difficulty)` and returned module member `_debugAI` with `choose`, `actions`, `resolve`, and `initialPieces` functions for Node regression tests.

- [ ] **Step 1: Write the failing fixed-position tests**

Create `tests/laser-ai.test.js` with a no-op Canvas context, deterministic `Math.random`, and these assertions:

```js
"use strict";
var assert = require("node:assert");
var LaserGame = require("../games/laser/laser-game.js");

function fakeContext(){
  var gradient = { addColorStop:function(){} };
  return new Proxy({
    measureText:function(s){ return {width:String(s).length * 8}; },
    createLinearGradient:function(){ return gradient; },
    createRadialGradient:function(){ return gradient; }
  }, {
    get:function(target, key){ return key in target ? target[key] : function(){}; },
    set:function(target, key, value){ target[key] = value; return true; }
  });
}

function piece(id, type, owner, row, col, orientation){
  return {id:id, type:type, owner:owner, row:row, col:col,
    orientation:orientation, alive:true};
}

var game = LaserGame.create(fakeContext(), 375, 667, function(){});
assert.ok(game._debugAI, "AI debug surface must exist");

var safePressure = [
  piece("bl", "laser", 1, 0, 0, 2),
  piece("bm", "mirror", 1, 3, 0, 0),
  piece("bk", "king", 1, 0, 5, 0),
  piece("rl", "laser", 0, 7, 9, 0),
  piece("rk", "king", 0, 4, 4, 0)
];

var mateThreat = [
  piece("bl", "laser", 1, 0, 0, 2),
  piece("bm", "mirror", 1, 3, 0, 0),
  piece("bk", "king", 1, 3, 5, 0),
  piece("rl", "laser", 0, 7, 5, 0),
  piece("rk", "king", 0, 4, 4, 0)
];

var savedRandom = Math.random;
Math.random = function(){ return 0; };
try {
  var normal = game._debugAI.choose(safePressure, 1, "normal");
  assert.equal(normal.pi, 1, "normal should use the mirror to build pressure");
  assert.equal(normal.kind, "rot");
  assert.equal(normal.d, 1);

  var hard = game._debugAI.choose(mateThreat, 1, "hard");
  assert.equal(hard.pi, 2, "hard should move the exposed king");
  assert.equal(hard.kind, "move");
  assert.notEqual(hard.c, 5);

  ["easy", "normal", "hard"].forEach(function(level){
    var suicide = [
      piece("bl", "laser", 1, 0, 0, 2),
      piece("bk", "king", 1, 3, 0, 0),
      piece("rk", "king", 0, 7, 9, 0),
      piece("rl", "laser", 0, 7, 8, 0)
    ];
    var action = game._debugAI.choose(suicide, 1, level);
    var result = game._debugAI.resolve(suicide, 1, action);
    assert.ok(!(result.eliminated && result.eliminated.id === "bk"),
      level + " must avoid firing into its own king when it can move");
  });

  var crossOwnerSwap = [
    piece("bs", "switch", 1, 4, 4, 0),
    piece("rm", "mirror", 0, 4, 5, 0)
  ];
  assert.ok(game._debugAI.actions(crossOwnerSwap, 1).some(function(action){
    return action.kind === "swap" && action.pi === 0 && action.ti === 1;
  }), "switch must be able to swap with an adjacent opponent mirror");

  var blueByRedZone = [
    piece("bs", "switch", 1, 4, 8, 0),
    piece("rm", "mirror", 0, 4, 9, 0)
  ];
  assert.ok(!game._debugAI.actions(blueByRedZone, 1).some(function(action){
    return (action.kind === "move" && action.r === 4 && action.c === 9) ||
      (action.kind === "swap" && action.ti === 1);
  }), "blue pieces must not move or swap into a red reserved cell");

  var redByBlueZone = [
    piece("rs", "switch", 0, 4, 1, 0),
    piece("bm", "mirror", 1, 4, 0, 0)
  ];
  assert.ok(!game._debugAI.actions(redByBlueZone, 0).some(function(action){
    return (action.kind === "move" && action.r === 4 && action.c === 0) ||
      (action.kind === "swap" && action.ti === 1);
  }), "red pieces must not move or swap into a blue reserved cell");
} finally {
  Math.random = savedRandom;
  game.exit();
}

console.log("laser AI regression tests passed");
```

- [ ] **Step 2: Run the test and verify RED**

Run: `node tests/laser-ai.test.js`

Expected: FAIL at `AI debug surface must exist` because `_debugAI` and difficulty-aware selection do not exist yet.

- [ ] **Step 3: Add minimal difficulty-aware scoring**

In `games/laser/laser-game.js`:

1. Add `AI_LEVELS` fixed parameters beside `PIECE_VAL`:

```js
var AI_LEVELS = {
  easy:   {attack:0.25, reply:0,   candidates:16, variety:8},
  normal: {attack:1.8,  reply:0.3, candidates:32, variety:3},
  hard:   {attack:1.2,  reply:1.0, candidates:40, variety:0.5}
};
```

2. Add `laserPressure(pieces, player)`. It must return a higher value when the player's beam path is longer, reflects toward the opponent half, or has a smaller Manhattan distance to the enemy king. It must use `simulateLaser` rather than duplicating beam rules.
3. Change `evaluatePosition` to accept the selected level and multiply offensive pressure by `AI_LEVELS[level].attack` while retaining material and king-safety terms.
4. Change `aiChoose` to accept `difficulty`, default unknown values to `normal`, score every legal action before candidate truncation, and add `{kind:"skip"}` to both players' candidate lists.
5. Reject actions whose own shot kills the AI king if any non-suicidal action exists.
6. For normal, apply only a light opponent best-response penalty. For hard, enumerate the selected opponent's complete legal actions, including cross-owner switch swaps, plus `skip`, and apply the full worst-response score; a reply that kills the AI king receives the existing `100000` terminal value. Do not pass `{noSwap:true}` in the hard reply search.
7. Return `_debugAI` from the game instance:

```js
_debugAI: {
  choose:function(pieces, player, level){ return aiChoose(pieces, player, level); },
  actions:function(pieces, player){ return generateActions(pieces, player); },
  resolve:function(pieces, player, action){ return resolveTurn(pieces, player, action); },
  initialPieces:function(layoutIndex){ return makeInitialPieces(layoutIndex); }
}
```

- [ ] **Step 4: Run the regression test and tune only fixed weights until GREEN**

Run: `node tests/laser-ai.test.js`

Expected: PASS with `laser AI regression tests passed`. If the fixture selects a different legal move, adjust only `AI_LEVELS` weights or the compact `laserPressure` formula; do not special-case piece IDs or board coordinates.

- [ ] **Step 5: Run syntax verification**

Run: `node --check games/laser/laser-game.js`

Expected: exit code 0 with no output.

- [ ] **Step 6: Commit the AI behavior**

```bash
git add games/laser/laser-game.js tests/laser-ai.test.js
git commit -m "feat: add three laser AI difficulty levels"
```

---

### Task 2: Difficulty Selection UI and Persistence

**Files:**
- Modify: `games/laser/laser-game.js:409-427,1528-1548,1705-1715,1967-1993`
- Modify: `tests/laser-ai.test.js`

**Interfaces:**
- Consumes: `aiChoose(pieces, aiPlayer, difficulty)` from Task 1.
- Produces: `G.difficulty`, `cycleDifficulty()`, and the select-phase button label `难度：简单|普通|困难`.

- [ ] **Step 1: Add failing state-cycle tests**

Append before `game.exit()` in `tests/laser-ai.test.js`:

```js
assert.equal(game._debugAI.getDifficulty(), "normal");
game._debugAI.cycleDifficulty();
assert.equal(game._debugAI.getDifficulty(), "hard");
game._debugAI.cycleDifficulty();
assert.equal(game._debugAI.getDifficulty(), "easy");
game._debugAI.restart();
assert.equal(game._debugAI.getDifficulty(), "easy",
  "restart must preserve the selected difficulty");
```

- [ ] **Step 2: Run the test and verify RED**

Run: `node tests/laser-ai.test.js`

Expected: FAIL because `getDifficulty`, `cycleDifficulty`, and `restart` do not exist.

- [ ] **Step 3: Implement the minimal UI state**

1. Add `difficulty:"normal"` to `G`, without assigning it in `startGame()`.
2. Add fixed order and labels:

```js
var DIFFICULTY_ORDER = ["easy", "normal", "hard"];
var DIFFICULTY_LABEL = {easy:"简单", normal:"普通", hard:"困难"};
function cycleDifficulty(){
  var i = DIFFICULTY_ORDER.indexOf(G.difficulty);
  G.difficulty = DIFFICULTY_ORDER[(i + 1) % DIFFICULTY_ORDER.length];
  render();
}
```

3. In the select-phase branch of `buildActionButtons`, add:

```js
addBtn("难度：" + DIFFICULTY_LABEL[G.difficulty], cycleDifficulty, "ghost");
```

The existing button layout already wraps after four buttons, so no new layout code is needed.

4. In `aiTurn`, call `aiChoose(G.pieces, G.aiPlayer, G.difficulty)`.
5. Extend `_debugAI` with `getDifficulty`, `cycleDifficulty`, and `restart:startGame` for state regression tests.

- [ ] **Step 4: Run all regression and syntax checks**

Run: `node tests/laser-ai.test.js`

Expected: PASS.

Run: `node --check games/laser/laser-game.js`

Expected: exit code 0.

- [ ] **Step 5: Commit the UI**

```bash
git add games/laser/laser-game.js tests/laser-ai.test.js
git commit -m "feat: let players select laser AI difficulty"
```

---

### Task 3: Integration and Performance Verification

**Files:**
- Verify: `games/laser/laser-game.js`
- Verify: `game.js`
- Verify: `tests/laser-ai.test.js`

**Interfaces:**
- Consumes: finished AI and UI behavior from Tasks 1-2.
- Produces: verified Node compatibility and bounded hard-mode response time.

- [ ] **Step 1: Run the complete automated verification**

Run:

```bash
node tests/laser-ai.test.js
node --check games/laser/laser-game.js
node --check game.js
```

Expected: every command exits 0 and the test prints `laser AI regression tests passed`.

- [ ] **Step 2: Measure hard-mode decision time on all five layouts**

Append this bounded performance check to `tests/laser-ai.test.js` before `game.exit()`:

```js
for(var layoutIndex = 0; layoutIndex < 5; layoutIndex++){
  var started = Date.now();
  game._debugAI.choose(game._debugAI.initialPieces(layoutIndex), 1, "hard");
  var elapsed = Date.now() - started;
  assert.ok(elapsed < 500,
    "hard layout " + layoutIndex + " took " + elapsed + "ms");
}
```

Run: `node tests/laser-ai.test.js`

Expected: PASS, with each hard decision below the generous 500 ms local regression ceiling. This ceiling is not a promise of identical device timing.

- [ ] **Step 3: Inspect the final diff and working tree**

Run:

```bash
git diff origin/main...HEAD --stat
git status --short
```

Expected: only the planned root-layout commit, design/plan documents, AI source, and regression test are present; the working tree is clean after commits.

- [ ] **Step 4: Commit the performance assertion**

```bash
git add tests/laser-ai.test.js
git commit -m "test: bound hard laser AI decision time"
```
