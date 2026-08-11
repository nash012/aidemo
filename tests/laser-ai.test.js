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

  assert.equal(game._debugAI.getDifficulty(), "normal");
  game._debugAI.cycleDifficulty();
  assert.equal(game._debugAI.getDifficulty(), "hard");
  game._debugAI.cycleDifficulty();
  assert.equal(game._debugAI.getDifficulty(), "easy");
  game._debugAI.restart();
  assert.equal(game._debugAI.getDifficulty(), "easy",
    "restart must preserve the selected difficulty");
} finally {
  Math.random = savedRandom;
  game.exit();
}

console.log("laser AI regression tests passed");
