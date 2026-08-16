"use strict";

/**
 * 纯 JavaScript 神经网络 AI 模块
 * 不依赖 onnxruntime-web，直接实现前向传播
 *
 * 模型架构: SimplePolicyNet
 *   Conv2d(16,32,3,pad=1) + BN + ReLU
 *   Conv2d(32,32,3,pad=1) + BN + ReLU
 *   Conv2d(32,16,3,pad=1) + BN + ReLU
 *   FC(1280,495) → policy
 *   FC(1280,32) + ReLU + FC(32,1) + Tanh → value
 *
 * 权重文件: laser_ai_{easy,normal,hard}.bin (由 export_weights.py 导出, float16)
 */

var C = require("../config/constants.js");
var Rules = require("./rules.js");
var AI = require("./ai.js");
var _laserPressure = AI.laserPressure;
var _attackingPresence = AI.attackingPresence;
var _potentialLaserThreat = AI.potentialLaserThreat;
var _findKing = AI.findKing;

var _moveHistory = [];
var MAX_HISTORY = 4;

var ROWS = C.BOARD.rows;
var COLS = C.BOARD.cols;
var DIRS8 = C.DIRS8;
var MAX_PIECES = 26;
var ACTIONS_PER_PIECE = 19;
var TOTAL_ACTIONS = MAX_PIECES * ACTIONS_PER_PIECE + 1;
var NUM_CHANNELS = 16;
var BN_EPS = 1e-5;

var PIECE_TYPES = ["laser", "king", "shield", "mirror", "switch"];
var PIECE_VALUE = { king: 10000, shield: 3, switch: 5, mirror: 4, laser: 0 };
var LASER_DIRS = C.LASER_DIRECTIONS;

var _models = { easy: null, normal: null, hard: null };
var _difficulty = "easy";

var NEURAL_CONFIG = {
  easy:   { policyWeight: 0.40, initScale: 1.5, blunder: 0.15, candidates: 10 },
  normal: { policyWeight: 0.70, initScale: 2.0, blunder: 0.00, candidates: 15 },
  hard:   { policyWeight: 1.00, initScale: 2.5, blunder: 0.00, candidates: 20 }
};

function countMaterial(pieces, player) {
  var total = 0;
  for (var i = 0; i < pieces.length; i++) {
    if (pieces[i].alive && pieces[i].owner === player) {
      total += PIECE_VALUE[pieces[i].type] || 0;
    }
  }
  return total;
}

function checkOpponentLaserThreat(newPieces, player) {
  var opp = 1 - player;
  var oppLaser = Rules.getLaser(newPieces, opp);
  if (!oppLaser) return 0;

  var maxThreat = 0;
  var dirs = LASER_DIRS[opp];
  var origDir = oppLaser.orientation;

  for (var d = 0; d < dirs.length; d++) {
    var dir = dirs[d];
    var sim;
    if (dir === origDir) {
      sim = Rules.simulateLaser(newPieces, oppLaser);
    } else {
      var altLaser = { row: oppLaser.row, col: oppLaser.col, orientation: dir, type: "laser", owner: opp, alive: true };
      sim = Rules.simulateLaser(newPieces, altLaser);
    }
    if (sim.eliminated && sim.eliminated.owner === player) {
      var val = PIECE_VALUE[sim.eliminated.type] || 0;
      var penalty = dir === origDir ? val * 10 : val * 4;
      if (penalty > maxThreat) maxThreat = penalty;
    }
  }

  return maxThreat;
}

function readFile(path) {
  if (typeof wx !== "undefined" && wx.getFileSystemManager) {
    try {
      return wx.getFileSystemManager().readFileSync(path);
    } catch (e) {
      console.log("[NeuralAI] readFileSync failed:", e.message || e);
      return null;
    }
  }
  try {
    var fs = require("fs");
    return fs.readFileSync(path);
  } catch (e) {
    return null;
  }
}

function float16ToFloat32(h) {
  var s = (h & 0x8000) >> 15;
  var e = (h & 0x7C00) >> 10;
  var f = h & 0x03FF;
  if (e === 0) {
    if (f === 0) return s ? -0 : 0;
    var val = f / 1024 * 1.5258789e-5;
    return s ? -val : val;
  }
  if (e === 0x1F) return f ? NaN : (s ? -Infinity : Infinity);
  var val = (1 + f / 1024) * Math.pow(2, e - 15);
  return s ? -val : val;
}

function parseWeights(buffer) {
  var view = new DataView(buffer);
  var offset = 0;

  var headerLen = view.getUint32(offset, true);
  offset += 4;

  var headerBytes = new Uint8Array(buffer, offset, headerLen);
  var headerStr = "";
  for (var i = 0; i < headerLen; i++) headerStr += String.fromCharCode(headerBytes[i]);
  var header = JSON.parse(headerStr);
  offset += headerLen;

  var totalFloats = view.getUint32(offset, true);
  offset += 4;

  var dtype = header["__dtype__"] || "float32";
  delete header["__dtype__"];

  var aligned = new Float32Array(totalFloats);

  if (dtype === "float16") {
    for (var i = 0; i < totalFloats; i++) {
      aligned[i] = float16ToFloat32(view.getUint16(offset + i * 2, true));
    }
  } else {
    var byteLen = totalFloats * 4;
    var srcBytes = new Uint8Array(buffer, offset, byteLen);
    var dstBytes = new Uint8Array(aligned.buffer);
    dstBytes.set(srcBytes);
  }

  var floatData = aligned;

  var result = {};
  for (var name in header) {
    var info = header[name];
    result[name] = floatData.subarray(info.offset, info.offset + info.count);
  }

  return result;
}

function conv2d(input, inChannels, outChannels, height, width, weight, stride) {
  stride = stride || 1;
  var kSize = 3;
  var pad = 1;
  var outH = Math.floor((height + 2 * pad - kSize) / stride) + 1;
  var outW = Math.floor((width + 2 * pad - kSize) / stride) + 1;
  var output = new Float32Array(outChannels * outH * outW);

  for (var oc = 0; oc < outChannels; oc++) {
    for (var oh = 0; oh < outH; oh++) {
      for (var ow = 0; ow < outW; ow++) {
        var sum = 0;
        for (var ic = 0; ic < inChannels; ic++) {
          for (var kh = 0; kh < kSize; kh++) {
            for (var kw = 0; kw < kSize; kw++) {
              var ih = oh * stride - pad + kh;
              var iw = ow * stride - pad + kw;
              if (ih < 0 || ih >= height || iw < 0 || iw >= width) continue;
              var inputIdx = ic * height * width + ih * width + iw;
              var weightIdx = oc * inChannels * kSize * kSize + ic * kSize * kSize + kh * kSize + kw;
              sum += input[inputIdx] * weight[weightIdx];
            }
          }
        }
        output[oc * outH * outW + oh * outW + ow] = sum;
      }
    }
  }

  return { data: output, height: outH, width: outW };
}

function batchNorm2d(input, channels, height, width, bnWeight, bnBias, runningMean, runningVar) {
  var output = new Float32Array(input.length);
  for (var c = 0; c < channels; c++) {
    var mean = runningMean[c];
    var varVal = runningVar[c];
    var scale = bnWeight[c] / Math.sqrt(varVal + BN_EPS);
    var shift = bnBias[c] - mean * scale;
    for (var i = 0; i < height * width; i++) {
      var idx = c * height * width + i;
      output[idx] = input[idx] * scale + shift;
    }
  }
  return output;
}

function relu(input) {
  for (var i = 0; i < input.length; i++) {
    if (input[i] < 0) input[i] = 0;
  }
  return input;
}

function linear(input, inFeatures, outFeatures, weight, bias) {
  var output = new Float32Array(outFeatures);
  for (var o = 0; o < outFeatures; o++) {
    var sum = bias ? bias[o] : 0;
    var rowOffset = o * inFeatures;
    for (var i = 0; i < inFeatures; i++) {
      sum += input[i] * weight[rowOffset + i];
    }
    output[o] = sum;
  }
  return output;
}

function tanh(x) {
  return Math.tanh(x);
}

function softmax(logits) {
  var max = -Infinity;
  for (var i = 0; i < logits.length; i++) {
    if (logits[i] > max) max = logits[i];
  }
  var sum = 0;
  var exps = new Float32Array(logits.length);
  for (var j = 0; j < logits.length; j++) {
    exps[j] = Math.exp(logits[j] - max);
    sum += exps[j];
  }
  if (sum === 0) sum = 1;
  for (var k = 0; k < exps.length; k++) {
    exps[k] /= sum;
  }
  return exps;
}

function forwardPass(boardTensor) {
  var w = _models[_difficulty];
  if (!w) return { policy: new Float32Array(TOTAL_ACTIONS), value: 0 };

  var conv1 = conv2d(boardTensor, 16, 32, ROWS, COLS, w["features.0.weight"]);
  var bn1 = batchNorm2d(conv1.data, 32, ROWS, COLS, w["features.1.weight"], w["features.1.bias"], w["features.1.running_mean"], w["features.1.running_var"]);
  relu(bn1);

  var conv2 = conv2d(bn1, 32, 32, ROWS, COLS, w["features.3.weight"]);
  var bn2 = batchNorm2d(conv2.data, 32, ROWS, COLS, w["features.4.weight"], w["features.4.bias"], w["features.4.running_mean"], w["features.4.running_var"]);
  relu(bn2);

  var conv3 = conv2d(bn2, 32, 16, ROWS, COLS, w["features.6.weight"]);
  var bn3 = batchNorm2d(conv3.data, 16, ROWS, COLS, w["features.7.weight"], w["features.7.bias"], w["features.7.running_mean"], w["features.7.running_var"]);
  relu(bn3);

  var flatSize = 16 * ROWS * COLS;
  var flattened = bn3;

  var policy = linear(flattened, flatSize, 495, w["fc_policy.weight"], w["fc_policy.bias"]);

  var valueHidden = linear(flattened, flatSize, 32, w["fc_value1.weight"], w["fc_value1.bias"]);
  relu(valueHidden);
  var valueRaw = linear(valueHidden, 32, 1, w["fc_value2.weight"], w["fc_value2.bias"]);
  var value = tanh(valueRaw[0]);

  return { policy: policy, value: value };
}

function encodeBoard(pieces, currentPlayer) {
  var board = new Float32Array(NUM_CHANNELS * ROWS * COLS);

  for (var i = 0; i < pieces.length; i++) {
    var p = pieces[i];
    if (!p.alive) continue;

    var row = p.row, col = p.col, owner = p.owner;
    var ptype = p.type, orient = p.orientation || 0;
    var typeIdx = PIECE_TYPES.indexOf(ptype);
    if (typeIdx < 0) continue;

    var chOffset;
    if (owner === currentPlayer) {
      chOffset = typeIdx;
    } else {
      chOffset = 5 + typeIdx;
    }
    board[chOffset * ROWS * COLS + row * COLS + col] = 1.0;

    if (orient >= 0 && orient <= 3) {
      board[(10 + orient) * ROWS * COLS + row * COLS + col] = 1.0;
    }
    board[15 * ROWS * COLS + row * COLS + col] = 1.0;
  }

  if (currentPlayer === 0) {
    for (var j = 0; j < ROWS * COLS; j++) {
      board[14 * ROWS * COLS + j] = 1.0;
    }
  }

  return board;
}

function encodeAction(action, pieces) {
  if (action.kind === "skip") return TOTAL_ACTIONS - 1;
  var pi = action.pi;
  if (pi === undefined || pi < 0 || pi >= MAX_PIECES) return TOTAL_ACTIONS - 1;
  var base = pi * ACTIONS_PER_PIECE;

  if (action.kind === "move") {
    var piece = pieces[pi];
    if (!piece) return TOTAL_ACTIONS - 1;
    for (var d = 0; d < 8; d++) {
      if (piece.row + DIRS8[d][0] === action.r && piece.col + DIRS8[d][1] === action.c) {
        return base + d;
      }
    }
    return TOTAL_ACTIONS - 1;
  }
  if (action.kind === "rot") return base + (action.d === 1 ? 8 : 9);
  if (action.kind === "laserRot") return base + 10;
  if (action.kind === "swap") {
    var sw = pieces[pi], tgt = pieces[action.ti];
    if (!sw || !tgt) return TOTAL_ACTIONS - 1;
    for (var s = 0; s < 8; s++) {
      if (sw.row + DIRS8[s][0] === tgt.row && sw.col + DIRS8[s][1] === tgt.col) {
        return base + 11 + s;
      }
    }
    return TOTAL_ACTIONS - 1;
  }
  return TOTAL_ACTIONS - 1;
}

function decodeAction(idx, pieces) {
  if (idx === TOTAL_ACTIONS - 1) return { kind: "skip" };
  if (idx < 0 || idx >= TOTAL_ACTIONS - 1) return { kind: "skip" };

  var pi = Math.floor(idx / ACTIONS_PER_PIECE);
  var offset = idx % ACTIONS_PER_PIECE;

  if (pi >= pieces.length || !pieces[pi].alive) return { kind: "skip" };

  var piece = pieces[pi];

  if (offset < 8) {
    return { pi: pi, kind: "move", r: piece.row + DIRS8[offset][0], c: piece.col + DIRS8[offset][1] };
  }
  if (offset === 8) return { pi: pi, kind: "rot", d: 1 };
  if (offset === 9) return { pi: pi, kind: "rot", d: 3 };
  if (offset === 10) return { pi: pi, kind: "laserRot", dir: 0 };
  if (offset >= 11 && offset < 19) {
    var s = offset - 11;
    for (var i = 0; i < pieces.length; i++) {
      if (pieces[i].alive && pieces[i].row === piece.row + DIRS8[s][0] && pieces[i].col === piece.col + DIRS8[s][1]) {
        return { pi: pi, kind: "swap", ti: i };
      }
    }
    return { kind: "skip" };
  }
  return { kind: "skip" };
}

function getLegalActions(pieces, player) {
  var actions = Rules.generateActions(pieces, player);
  actions.push({ kind: "skip" });
  return actions;
}

function getLegalMask(pieces, player) {
  var mask = new Float32Array(TOTAL_ACTIONS);
  var actions = getLegalActions(pieces, player);
  for (var i = 0; i < actions.length; i++) {
    var idx = encodeAction(actions[i], pieces);
    if (idx >= 0 && idx < TOTAL_ACTIONS) mask[idx] = 1;
  }
  return mask;
}

function validateAction(action, pieces, player) {
  var legalActions = getLegalActions(pieces, player);
  for (var k = 0; k < legalActions.length; k++) {
    if (legalActions[k].kind === action.kind) {
      if (action.kind === "skip") return true;
      if (legalActions[k].pi === action.pi && legalActions[k].kind === action.kind) {
        if (action.kind === "move") {
          if (legalActions[k].r === action.r && legalActions[k].c === action.c) return true;
        } else if (action.kind === "rot") {
          if (legalActions[k].d === action.d) return true;
        } else if (action.kind === "laserRot") {
          return true;
        } else if (action.kind === "swap") {
          if (legalActions[k].ti === action.ti) return true;
        }
      }
    }
  }
  return false;
}

var NeuralAI = {
  isLoaded: function() { return _models[_difficulty] !== null; },

  isDifficultyLoaded: function(difficulty) {
    return _models[difficulty] !== null;
  },

  setDifficulty: function(difficulty) {
    _difficulty = difficulty;
  },

  getDifficulty: function() {
    return _difficulty;
  },

  load: function(modelPath, difficulty, callback) {
    if (!difficulty) difficulty = "easy";
    try {
      var buffer = readFile(modelPath);
      if (!buffer) {
        console.log("[NeuralAI] model file not found:", modelPath);
        if (callback) callback(new Error("cannot read model file"));
        return;
      }

      var arrayBuffer;
      if (buffer instanceof ArrayBuffer) {
        arrayBuffer = buffer;
      } else if (buffer.byteLength !== undefined) {
        arrayBuffer = new ArrayBuffer(buffer.byteLength);
        new Uint8Array(arrayBuffer).set(new Uint8Array(buffer));
      } else {
        arrayBuffer = new ArrayBuffer(buffer.length);
        new Uint8Array(arrayBuffer).set(new Uint8Array(buffer));
      }

      _models[difficulty] = parseWeights(arrayBuffer);
      console.log("[NeuralAI] model loaded:", modelPath, "for", difficulty, "(" + (arrayBuffer.byteLength / 1024).toFixed(1) + " KB)");
      if (callback) callback(null);
    } catch (e) {
      console.log("[NeuralAI] load error:", e.message || e);
      if (callback) callback(e);
    }
  },

  choose: function(pieces, player, passiveTurns) {
    if (!_models[_difficulty]) return null;

    passiveTurns = Math.min(3, Math.max(0, passiveTurns || 0));

    var cfg = NEURAL_CONFIG[_difficulty] || NEURAL_CONFIG.easy;

    var legalActions = getLegalActions(pieces, player);
    if (legalActions.length === 0) return { kind: "skip" };

    var boardData = encodeBoard(pieces, player);
    var result = forwardPass(boardData);
    var logits = result.policy;

    var myMatBefore = countMaterial(pieces, player);
    var oppMatBefore = countMaterial(pieces, 1 - player);
    var threatBefore = _laserPressure(pieces, player) + _attackingPresence(pieces, player) * 0.35;

    var initScale = cfg.initScale * (1 + passiveTurns * 0.6);

    var stage1 = [];

    for (var i = 0; i < legalActions.length; i++) {
      var action = legalActions[i];
      var actionIdx = encodeAction(action, pieces);
      var policyLogit = (actionIdx >= 0 && actionIdx < TOTAL_ACTIONS) ? logits[actionIdx] : -1e9;

      var score = policyLogit * cfg.policyWeight;
      var isKingKill = false;
      var isSuicide = false;
      var turnResult = null;

      try {
        turnResult = Rules.resolveTurn(pieces, player, action);
        var newPieces = turnResult.np;

        if (turnResult.eliminated && turnResult.eliminated.type === "king") {
          if (turnResult.eliminated.owner === player) {
            isSuicide = true;
          } else {
            isKingKill = true;
          }
        }

        if (isKingKill) {
          action._value = result.value;
          _moveHistory.push(action.pi !== undefined ? action.pi : -1);
          if (_moveHistory.length > MAX_HISTORY) _moveHistory.shift();
          return action;
        }

        if (isSuicide) {
          continue;
        }

        var myMatAfter = countMaterial(newPieces, player);
        var oppMatAfter = countMaterial(newPieces, 1 - player);
        var selfDamage = myMatBefore - myMatAfter;
        var oppDamage = oppMatBefore - oppMatAfter;

        score -= selfDamage * 8;
        score += oppDamage * 10;

        if (selfDamage > 0 && oppDamage === 0) {
          score -= selfDamage * 5;
        }

        var threatAfter = _laserPressure(newPieces, player) + _attackingPresence(newPieces, player) * 0.35;
        var threatGain = threatAfter - threatBefore;
        score += threatGain * initScale;

        if (action.kind === "skip") {
          score -= initScale * 2.0;
        }

        var oppThreat = checkOpponentLaserThreat(newPieces, player);
        score -= oppThreat;

        if (action.pi !== undefined && action.pi >= 0) {
          var repeatCount = 0;
          for (var h = 0; h < _moveHistory.length; h++) {
            if (_moveHistory[h] === action.pi) repeatCount++;
          }
          score -= repeatCount * 5.0;
        }

      } catch (e) {
        // keep policy score only
      }

      stage1.push({ action: action, score: score, turnResult: turnResult });
    }

    stage1.sort(function(a, b) { return b.score - a.score; });

    var K = Math.min(cfg.candidates, stage1.length);
    var bestScore = -Infinity;
    var bestAction = stage1.length > 0 ? stage1[0].action : { kind: "skip" };
    var potThreatBefore = _potentialLaserThreat(pieces, player);

    for (var c = 0; c < K; c++) {
      var candidate = stage1[c];
      var score = candidate.score;

      if (candidate.turnResult && candidate.turnResult.np) {
        try {
          var newPieces = candidate.turnResult.np;

          var potThreatAfter = _potentialLaserThreat(newPieces, player);
          score += (potThreatAfter - potThreatBefore) * initScale * 0.5;

          var oppBoard = encodeBoard(newPieces, 1 - player);
          var oppResult = forwardPass(oppBoard);
          score += -oppResult.value * 2.0;
        } catch (e) {
          // keep stage1 score
        }
      }

      if (score > bestScore) {
        bestScore = score;
        bestAction = candidate.action;
      }
    }

    if (bestAction.pi !== undefined) {
      _moveHistory.push(bestAction.pi);
      if (_moveHistory.length > MAX_HISTORY) _moveHistory.shift();
    }

    if (cfg.blunder > 0 && Math.random() < cfg.blunder) {
      var safeActions = stage1.filter(function(c) {
        return c.turnResult !== null;
      });
      if (safeActions.length > 1) {
        bestAction = safeActions[Math.floor(Math.random() * safeActions.length)].action;
      }
    }

    bestAction._value = result.value;
    return bestAction;
  },

  chooseAsync: function(pieces, player, passiveTurns, callback) {
    try {
      var action = this.choose(pieces, player, passiveTurns);
      if (callback) callback(null, action);
    } catch (e) {
      console.error("[NeuralAI] inference error:", e);
      if (callback) callback(e, null);
    }
  },

  resetHistory: function() {
    _moveHistory = [];
  },

  unload: function() {
    _models = { easy: null, normal: null, hard: null };
    console.log("[NeuralAI] all models unloaded");
  }
};

module.exports = NeuralAI;
