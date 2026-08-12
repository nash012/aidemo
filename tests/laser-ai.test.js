"use strict";

var assert = require("node:assert");
var LaserGame = require("../games/laser/laser-game.js");

function fakeContext(){
  var gradient = { addColorStop:function(){} };
  var texts = [];
  var arcs = [];
  return new Proxy({
    _texts:texts, _arcs:arcs,
    fillText:function(text){ texts.push(text); },
    arc:function(x, y, radius){ arcs.push({radius:radius, strokeStyle:this.strokeStyle}); },
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

function testAiAnimation(action, beforeSeconds, advanceSeconds, expected){
  var animCtx = fakeContext();
  var animGame = LaserGame.create(animCtx, 375, 667, function(){});
  animGame._debugGame.beginMatch();
  var before = animGame._debugGame.snapshot().pieces;
  animGame._debugEffects.beginAiAction(action);
  assert.equal(animGame._debugGame.snapshot().busy, true);
  animGame.update(beforeSeconds);
  assert.deepEqual(animGame._debugGame.snapshot().pieces, before,
    action.kind + " must not mutate rule state before animation completion");
  animGame.update(advanceSeconds - beforeSeconds);
  var snap = animGame._debugGame.snapshot();
  expected(snap, animCtx);
  assert.equal(snap.aiAnim, null);
  assert.equal(snap.busy, true,
    action.kind + " must keep input blocked while the laser runs");
  animGame.update(0.20);
  assert.deepEqual(animGame._debugGame.snapshot().pieces, snap.pieces,
    action.kind + " must commit exactly once");
  animGame.exit();
}

var game = LaserGame.create(fakeContext(), 375, 667, function(){});
assert.ok(game._debugAI, "AI debug surface must exist");

assert.ok(game._debugGame, "game-state debug surface must exist");

var initial = game._debugGame.snapshot();
assert.equal(initial.screen, "setup");
assert.equal(initial.layoutIdx, 0);
assert.equal(initial.difficulty, "normal");
assert.deepEqual(initial.pieces, game._debugAI.initialPieces(0));
initial.pieces[0].row = -1;
assert.deepEqual(game._debugGame.snapshot().pieces, game._debugAI.initialPieces(0),
  "snapshot must not expose mutable game pieces");

for(var previewLayout = 0; previewLayout < 5; previewLayout++){
  game._debugGame.selectLayout(previewLayout);
  assert.deepEqual(
    game._debugGame.snapshot().pieces,
    game._debugAI.initialPieces(previewLayout),
    "setup preview must use the real layout " + previewLayout
  );
}

game._debugGame.selectLayout(2);
game._debugGame.selectDifficulty("easy");
game._debugGame.openRules();
game._debugGame.closeModal();
assert.equal(game._debugGame.snapshot().layoutIdx, 2);
assert.equal(game._debugGame.snapshot().difficulty, "easy");

game._debugGame.beginMatch();
var startedMatch = game._debugGame.snapshot();
assert.equal(startedMatch.screen, "playing");
assert.equal(startedMatch.lockedLayoutIdx, 2);
assert.equal(startedMatch.lockedDifficulty, "easy");

game._debugGame.selectLayout(4);
game._debugGame.selectDifficulty("hard");
var stillLocked = game._debugGame.snapshot();
assert.equal(stillLocked.layoutIdx, 2, "layout is immutable during play");
assert.equal(stillLocked.difficulty, "easy", "difficulty is immutable during play");

game._debugGame.requestReturn();
assert.equal(game._debugGame.snapshot().modal, "confirmReturn");
game._debugGame.closeModal();
assert.equal(game._debugGame.snapshot().screen, "playing");
assert.deepEqual(game._debugGame.snapshot().pieces, startedMatch.pieces,
  "cancelling return preserves match progress");

game._debugGame.requestReturn();
game._debugGame.confirmReturn();
var returned = game._debugGame.snapshot();
assert.equal(returned.screen, "setup");
assert.equal(returned.modal, null);
assert.equal(returned.layoutIdx, 2);
assert.equal(returned.difficulty, "easy");
assert.deepEqual(returned.pieces, game._debugAI.initialPieces(2));

var uiCtx = fakeContext();
var uiGame = LaserGame.create(uiCtx, 375, 667, function(){});
uiGame.render();
assert.ok(uiCtx._texts.indexOf("选择阵型") >= 0);
assert.ok(uiCtx._texts.indexOf("选择难度") >= 0);
assert.ok(uiCtx._texts.indexOf("规则介绍") >= 0);
assert.ok(uiCtx._texts.indexOf("开始游戏") >= 0);
assert.equal(uiGame._debugGame.snapshot().screen, "setup");

uiGame._debugGame.openRules();
uiGame.onTouchStart({touches:[{clientX:188, clientY:450}]});
uiGame.onTouchMove({touches:[{clientX:188, clientY:250}]});
assert.ok(uiGame._debugGame.snapshot().rulesScroll > 0,
  "rules drag must scroll the clipped body");
uiGame.onTouchEnd({touches:[], changedTouches:[{clientX:188, clientY:250}]});
uiCtx._texts.length = 0;
uiGame.render();
assert.ok(uiCtx._texts.indexOf("双面镜互换") >= 0);
assert.ok(uiCtx._texts.some(function(text){
  return text.indexOf("包括对方棋子") >= 0;
}));
assert.ok(uiCtx._texts.some(function(text){
  return text.indexOf("蓝方不能进入红色区域") >= 0;
}));

uiGame._debugGame.closeModal();
uiGame._debugGame.beginMatch();
uiCtx._texts.length = 0;
uiGame.render();
assert.equal(uiCtx._texts.indexOf("选择难度"), -1);
assert.equal(uiCtx._texts.indexOf("阵型选择"), -1);
assert.ok(uiCtx._texts.indexOf("返回设置") >= 0);

uiGame._debugGame.requestReturn();
uiCtx._texts.length = 0;
uiGame.render();
assert.ok(uiCtx._texts.some(function(text){
  return text.indexOf("当前对局进度将丢失") >= 0;
}));
uiGame.exit();

var startCtx = fakeContext();
var startGame = LaserGame.create(startCtx, 375, 667, function(){});
var startTouch = {clientX:280, clientY:565};
startGame.onTouchStart({touches:[startTouch]});
startGame.onTouchEnd({touches:[], changedTouches:[startTouch]});
assert.equal(startGame._debugGame.snapshot().screen, "playing",
  "the production start button must begin the default match");
startGame.exit();

var safePressure = [
  piece("bl", "laser", 1, 0, 0, 2),
  piece("bm", "mirror", 1, 3, 0, 0),
  piece("bk", "king", 1, 0, 5, 0),
  piece("rl", "laser", 0, 7, 9, 0),
  piece("rk", "king", 0, 4, 4, 0)
];

assert.deepEqual(game._debugAI.config("easy"), {
  attack:0.65, defense:1.25, guard:1.7,
  reply:0, candidates:24, variety:5
});
assert.deepEqual(game._debugAI.config("normal"), {
  attack:2.0, defense:0.9, guard:0.8,
  reply:0.55, candidates:40, variety:1.5
});
assert.deepEqual(game._debugAI.config("hard"), {
  attack:1.2, defense:1.2, guard:1.5,
  reply:1.0, candidates:40, variety:0.5
});
var easyConfig = game._debugAI.config("easy");
easyConfig.attack = 99;
assert.equal(game._debugAI.config("easy").attack, 0.65,
  "config must not expose mutable AI level settings");

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
  ["easy", "normal"].forEach(function(level){
    var action = game._debugAI.choose(safePressure, 1, level);
    assert.equal(action.pi, 1, level + " should use the mirror to build pressure");
    assert.equal(action.kind, "rot");
    assert.equal(action.d, 1);
  });

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

  testAiAnimation({pi:14, kind:"move", r:5, c:7}, 0.73, 0.75, function(snap, ctx){
    assert.equal(snap.pieces[14].row, 5);
    assert.equal(snap.pieces[14].col, 7);
    assert.ok(ctx._texts.some(function(text){
      return text.indexOf("电脑移动：") === 0;
    }));
  });

  testAiAnimation({pi:14, kind:"rot", d:1}, 0.67, 0.70, function(snap, ctx){
    assert.equal(snap.pieces[14].orientation,
      (game._debugAI.initialPieces(0)[14].orientation + 1) % 4);
    assert.ok(ctx._texts.indexOf("电脑旋转棋子") >= 0);
  });

  testAiAnimation({pi:25, kind:"laserRot", dir:1}, 0.67, 0.70, function(snap){
    assert.equal(snap.pieces[25].orientation, 1);
  });

  var animatedSwap = [
    piece("bs", "switch", 1, 4, 4, 0),
    piece("rm", "mirror", 0, 4, 5, 0)
  ];
  var swapCtx = fakeContext();
  var swapGame = LaserGame.create(swapCtx, 375, 667, function(){});
  swapGame._debugGame.beginMatch();
  swapGame._debugEffects.setPieces(animatedSwap);
  swapCtx._arcs.length = 0;
  swapGame._debugEffects.beginAiAction({pi:0, kind:"swap", ti:1});
  assert.equal(swapGame._debugGame.snapshot().busy, true);
  assert.equal(swapCtx._arcs.filter(function(arc){
    return arc.strokeStyle === "rgba(255,225,77,0.95)";
  }).length, 2, "swap lead-in must highlight both pieces");
  swapCtx._arcs.length = 0;
  swapGame.update(0.70);
  assert.equal(swapCtx._arcs.filter(function(arc){
    return arc.strokeStyle.indexOf("rgba(255,225,77,") === 0;
  }).length, 2, "swap landing must pulse both destinations");
  swapGame.update(0.09);
  assert.deepEqual(swapGame._debugGame.snapshot().pieces, animatedSwap,
    "swap must keep both rule positions unchanged during animation");
  swapGame.update(0.02);
  var swapped = swapGame._debugEffects.snapshot();
  assert.equal(swapped.pieces[0].row, 4);
  assert.equal(swapped.pieces[0].col, 5);
  assert.equal(swapped.pieces[1].row, 4);
  assert.equal(swapped.pieces[1].col, 4);
  assert.equal(swapped.aiAnim, null);
  assert.ok(swapCtx._texts.indexOf("电脑互换棋子") >= 0);
  swapGame.update(0.20);
  assert.deepEqual(swapGame._debugEffects.snapshot().pieces, swapped.pieces,
    "swap must commit exactly once");
  swapGame.exit();

  testAiAnimation({kind:"skip"}, 0.51, 0.53, function(snap, ctx){
    assert.deepEqual(snap.pieces, game._debugAI.initialPieces(0));
    assert.equal(snap.actionNotice, "电脑选择直接发射");
    assert.ok(ctx._texts.indexOf("电脑选择直接发射") >= 0);
  });

  var invalidGame = LaserGame.create(fakeContext(), 375, 667, function(){});
  invalidGame._debugGame.beginMatch();
  invalidGame._debugEffects.beginAiAction({pi:999, kind:"move", r:3, c:3});
  var recovered = invalidGame._debugGame.snapshot();
  assert.equal(recovered.aiAnim, null);
  assert.equal(recovered.phase, "anim",
    "an animation creation failure must continue immediately to laser fire");
  assert.equal(recovered.busy, true);
  invalidGame.exit();

  var exitGame = LaserGame.create(fakeContext(), 375, 667, function(){});
  exitGame._debugGame.beginMatch();
  var exitPieces = exitGame._debugGame.snapshot().pieces;
  exitGame._debugEffects.beginAiAction({pi:14, kind:"move", r:5, c:7});
  exitGame.exit();
  var exited = exitGame._debugEffects.snapshot();
  assert.equal(exited.aiAnim, null, "exit must clear a pending AI animation");
  assert.equal(exited.actionNotice, null, "exit must clear the AI action notice");
  assert.equal(exited.timeoutCount, 0, "exit must clear tracked timers");
  exitGame.update(1);
  var afterExitUpdate = exitGame._debugEffects.snapshot();
  assert.deepEqual(afterExitUpdate.pieces, exitPieces,
    "update after exit must not commit the pending action");
  assert.equal(afterExitUpdate.aiAnim, null);
  assert.equal(afterExitUpdate.actionNotice, null);
  assert.equal(afterExitUpdate.timeoutCount, 0,
    "update after exit must not create a timer");

  for(var levelIndex = 0; levelIndex < 3; levelIndex++){
    var level = ["easy", "normal", "hard"][levelIndex];
    for(var layoutIndex = 0; layoutIndex < 5; layoutIndex++){
      var started = Date.now();
      game._debugAI.choose(game._debugAI.initialPieces(layoutIndex), 1, level);
      var elapsed = Date.now() - started;
      assert.ok(elapsed < 500,
        level + " layout " + layoutIndex + " took " + elapsed + "ms");
    }
  }
} finally {
  Math.random = savedRandom;
  game.exit();
}

var savedWx = global.wx;
var savedRequestAnimationFrame = global.requestAnimationFrame;
var suiteCtx = fakeContext();
var suiteHandlers = {};
var suiteFrame = null;
global.wx = {
  getWindowInfo:function(){ return {windowWidth:375, windowHeight:667, pixelRatio:1}; },
  createCanvas:function(){ return {getContext:function(){ return suiteCtx; }}; },
  onTouchStart:function(fn){ suiteHandlers.start = fn; },
  onTouchMove:function(fn){ suiteHandlers.move = fn; },
  onTouchEnd:function(fn){ suiteHandlers.end = fn; },
  onTouchCancel:function(fn){ suiteHandlers.cancel = fn; }
};
global.requestAnimationFrame = function(fn){ suiteFrame = fn; };
try {
  delete require.cache[require.resolve("../game.js")];
  require("../game.js");

  var laserCard = {clientX:100, clientY:320};
  suiteHandlers.start({touches:[laserCard]});
  suiteHandlers.end({touches:[], changedTouches:[laserCard]});
  suiteCtx._texts.length = 0;
  suiteHandlers.start({touches:[{clientX:20, clientY:20}]});
  suiteFrame(16);
  assert.ok(suiteCtx._texts.some(function(text){ return text.indexOf("游戏合集") >= 0; }),
    "suite back must leave laser setup for the game menu");

  suiteHandlers.start({touches:[laserCard]});
  suiteHandlers.end({touches:[], changedTouches:[laserCard]});
  var productionStart = {clientX:280, clientY:565};
  suiteHandlers.start({touches:[productionStart]});
  suiteHandlers.end({touches:[], changedTouches:[productionStart]});
  suiteCtx._texts.length = 0;
  suiteHandlers.start({touches:[{clientX:20, clientY:20}]});
  suiteFrame(32);
  assert.ok(suiteCtx._texts.indexOf("返回后当前对局进度将丢失。") >= 0,
    "suite back must request confirmation during a laser match");
  assert.ok(!suiteCtx._texts.some(function(text){ return text.indexOf("游戏合集") >= 0; }),
    "suite back must not discard an active laser match");
} finally {
  delete require.cache[require.resolve("../game.js")];
  if(savedWx === undefined) delete global.wx;
  else global.wx = savedWx;
  if(savedRequestAnimationFrame === undefined) delete global.requestAnimationFrame;
  else global.requestAnimationFrame = savedRequestAnimationFrame;
}

console.log("laser AI regression tests passed");
