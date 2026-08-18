"use strict";

/**
 * 纯 JavaScript 神经网络 AI 模块
 * 不依赖 onnxruntime-web，直接实现前向传播
 *
 * 模型架构: LaserChessNet (双头 ResNet)
 *   Conv2d(16,64,3,pad=1) + BN + ReLU
 *   4x ResBlock (conv+bn+relu+conv+bn + SE + residual)
 *   Policy head: Conv2d(64,32,1) + BN + ReLU + FC(2560,495)
 *   Value head: Conv2d(64,1,1) + BN + ReLU + FC(80,256) + ReLU + FC(256,1) + Tanh
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
var _lastPositions = {};
var _pieceMoveCount = {};
var _lastActionKey = null;
var _boardStateHistory = [];
var MAX_STATE_HISTORY = 6;

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
  easy:   {
    policyWeight: 0.35, initScale: 1.5, blunder: 0.15, candidates: 10,
    refineCandidates: 3,
    tacticalScale: 30, temperature: 1.2, fusionAlpha: 0.35, valueWeight: 0.8,
    repeatPenalty: 15, backtrackPenalty: 40, explorationBonus: 2.0
  },
  normal: {
    policyWeight: 0.55, initScale: 2.0, blunder: 0.00, candidates: 15,
    refineCandidates: 5,
    tacticalScale: 40, temperature: 1.0, fusionAlpha: 0.45, valueWeight: 1.2,
    repeatPenalty: 20, backtrackPenalty: 50, explorationBonus: 3.0
  },
  hard:   {
    policyWeight: 0.70, initScale: 2.5, blunder: 0.00, candidates: 20,
    refineCandidates: 8,
    tacticalScale: 50, temperature: 0.8, fusionAlpha: 0.55, valueWeight: 1.5,
    repeatPenalty: 25, backtrackPenalty: 60, explorationBonus: 4.0
  }
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

function boardStateHash(pieces) {
  var hash = "";
  for (var i = 0; i < pieces.length; i++) {
    var p = pieces[i];
    if (p.alive) {
      hash += i + ":" + p.row + "," + p.col + "," + (p.orientation || 0) + ";";
    }
  }
  return hash;
}

function isInStateHistory(hash) {
  for (var i = 0; i < _boardStateHistory.length; i++) {
    if (_boardStateHistory[i] === hash) return i;
  }
  return -1;
}

function checkOpponentLaserThreat(newPieces, player) {
  var opp = 1 - player;
  var oppLaser = Rules.getLaser(newPieces, opp);
  if (!oppLaser) return 0;

  var sim = Rules.simulateLaser(newPieces, oppLaser);
  if (sim.eliminated && sim.eliminated.owner === player) {
    var val = PIECE_VALUE[sim.eliminated.type] || 0;
    return val * 10;
  }

  var dirs = LASER_DIRS[opp];
  for (var d = 0; d < dirs.length; d++) {
    var dir = dirs[d];
    if (dir === oppLaser.orientation) continue;
    var altLaser = { row: oppLaser.row, col: oppLaser.col, orientation: dir, type: "laser", owner: opp, alive: true };
    var sim2 = Rules.simulateLaser(newPieces, altLaser);
    if (sim2.eliminated && sim2.eliminated.owner === player) {
      var val2 = PIECE_VALUE[sim2.eliminated.type] || 0;
      return Math.max(val2 * 4, 0);
    }
  }

  return 0;
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

function conv2d(input, inChannels, outChannels, height, width, weight, stride, kSize, pad) {
  stride = stride || 1;
  kSize = kSize || 3;
  pad = pad !== undefined ? pad : 1;
  var outH = Math.floor((height + 2 * pad - kSize) / stride) + 1;
  var outW = Math.floor((width + 2 * pad - kSize) / stride) + 1;

  var kernelSize = kSize * kSize * inChannels;
  var col = new Float32Array(outH * outW * kernelSize);

  for (var oh = 0; oh < outH; oh++) {
    for (var ow = 0; ow < outW; ow++) {
      var colRow = (oh * outW + ow) * kernelSize;
      for (var ic = 0; ic < inChannels; ic++) {
        for (var kh = 0; kh < kSize; kh++) {
          for (var kw = 0; kw < kSize; kw++) {
            var ih = oh * stride - pad + kh;
            var iw = ow * stride - pad + kw;
            var val = 0;
            if (ih >= 0 && ih < height && iw >= 0 && iw < width) {
              val = input[ic * height * width + ih * width + iw];
            }
            col[colRow++] = val;
          }
        }
      }
    }
  }

  var output = new Float32Array(outChannels * outH * outW);
  for (var oc = 0; oc < outChannels; oc++) {
    var wOffset = oc * kernelSize;
    for (var pos = 0; pos < outH * outW; pos++) {
      var sum = 0;
      var colOffset = pos * kernelSize;
      for (var k = 0; k < kernelSize; k++) {
        sum += col[colOffset + k] * weight[wOffset + k];
      }
      output[oc * outH * outW + pos] = sum;
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

function softmaxWithTemperature(logits, mask, temperature) {
  var invT = 1.0 / Math.max(0.01, temperature);
  var max = -Infinity;
  for (var i = 0; i < logits.length; i++) {
    if (mask && mask[i] === 0) continue;
    var v = logits[i] * invT;
    if (v > max) max = v;
  }
  var sum = 0;
  var exps = new Float32Array(logits.length);
  for (var j = 0; j < logits.length; j++) {
    if (mask && mask[j] === 0) { exps[j] = 0; continue; }
    exps[j] = Math.exp(logits[j] * invT - max);
    sum += exps[j];
  }
  if (sum === 0) sum = 1;
  for (var k = 0; k < exps.length; k++) {
    exps[k] /= sum;
  }
  return exps;
}

function normalizeTacticalScore(rawScore, scale) {
  return Math.tanh(rawScore / Math.max(1, scale));
}

function detectNumResBlocks(w) {
  var maxBlock = -1;
  for (var key in w) {
    var m = key.match(/^res_blocks\.(\d+)\./);
    if (m) {
      var idx = parseInt(m[1]);
      if (idx > maxBlock) maxBlock = idx;
    }
  }
  return maxBlock + 1;
}

function detectNumChannels(w) {
  if (w["conv_init.weight"]) {
    var totalFloats = w["conv_init.weight"].length;
    var inCh = 16;
    var kSize = 3;
    return totalFloats / (inCh * kSize * kSize);
  }
  return 64;
}

function forwardPass(boardTensor) {
  var w = _models[_difficulty];
  if (!w) return { policy: new Float32Array(TOTAL_ACTIONS), value: 0 };

  var numChannels = detectNumChannels(w);
  var numResBlocks = detectNumResBlocks(w);
  var seReduction = 16;
  var seChannels = Math.floor(numChannels / seReduction);

  var conv = conv2d(boardTensor, 16, numChannels, ROWS, COLS, w["conv_init.weight"]);
  var bn = batchNorm2d(conv.data, numChannels, ROWS, COLS, w["bn_init.weight"], w["bn_init.bias"], w["bn_init.running_mean"], w["bn_init.running_var"]);
  relu(bn);
  var h = bn;

  for (var b = 0; b < numResBlocks; b++) {
    var prefix = "res_blocks." + b + ".";
    var residual = h;

    var c1 = conv2d(h, numChannels, numChannels, ROWS, COLS, w[prefix + "conv1.weight"]);
    var b1 = batchNorm2d(c1.data, numChannels, ROWS, COLS, w[prefix + "bn1.weight"], w[prefix + "bn1.bias"], w[prefix + "bn1.running_mean"], w[prefix + "bn1.running_var"]);
    relu(b1);

    var c2 = conv2d(b1, numChannels, numChannels, ROWS, COLS, w[prefix + "conv2.weight"]);
    var b2 = batchNorm2d(c2.data, numChannels, ROWS, COLS, w[prefix + "bn2.weight"], w[prefix + "bn2.bias"], w[prefix + "bn2.running_mean"], w[prefix + "bn2.running_var"]);

    if (w[prefix + "se.fc1.weight"]) {
      var squeezed = new Float32Array(numChannels);
      for (var c = 0; c < numChannels; c++) {
        var s = 0;
        for (var i = 0; i < ROWS * COLS; i++) {
          s += b2[c * ROWS * COLS + i];
        }
        squeezed[c] = s / (ROWS * COLS);
      }
      var seFc1Out = linear(squeezed, numChannels, seChannels, w[prefix + "se.fc1.weight"], w[prefix + "se.fc1.bias"]);
      relu(seFc1Out);
      var seFc2Out = linear(seFc1Out, seChannels, numChannels, w[prefix + "se.fc2.weight"], w[prefix + "se.fc2.bias"]);
      for (var c2 = 0; c2 < numChannels; c2++) {
        seFc2Out[c2] = 1.0 / (1.0 + Math.exp(-seFc2Out[c2]));
      }
      for (var c3 = 0; c3 < numChannels; c3++) {
        var scale = seFc2Out[c3];
        for (var i2 = 0; i2 < ROWS * COLS; i2++) {
          b2[c3 * ROWS * COLS + i2] *= scale;
        }
      }
    }

    for (var i3 = 0; i3 < h.length; i3++) {
      b2[i3] += residual[i3];
    }
    relu(b2);
    h = b2;
  }

  var policyConv = conv2d(h, numChannels, 32, ROWS, COLS, w["policy_conv.weight"], 1, 1, 0);
  var policyBn = batchNorm2d(policyConv.data, 32, ROWS, COLS, w["policy_bn.weight"], w["policy_bn.bias"], w["policy_bn.running_mean"], w["policy_bn.running_var"]);
  relu(policyBn);
  var policyFlatSize = 32 * ROWS * COLS;
  var policy = linear(policyBn, policyFlatSize, 495, w["policy_fc.weight"], w["policy_fc.bias"]);

  var valueConv = conv2d(h, numChannels, 1, ROWS, COLS, w["value_conv.weight"], 1, 1, 0);
  var valueBn = batchNorm2d(valueConv.data, 1, ROWS, COLS, w["value_bn.weight"], w["value_bn.bias"], w["value_bn.running_mean"], w["value_bn.running_var"]);
  relu(valueBn);
  var valueFlatSize = 1 * ROWS * COLS;
  var valueHidden = linear(valueBn, valueFlatSize, 256, w["value_fc1.weight"], w["value_fc1.bias"]);
  relu(valueHidden);
  var valueRaw = linear(valueHidden, 256, 1, w["value_fc2.weight"], w["value_fc2.bias"]);
  var value = tanh(valueRaw[0]);

  return { policy: policy, value: value };
}

function forwardPassAsync(boardTensor, callback) {
  var w = _models[_difficulty];
  if (!w) {
    callback({ policy: new Float32Array(TOTAL_ACTIONS), value: 0 });
    return;
  }

  var numChannels = detectNumChannels(w);
  var numResBlocks = detectNumResBlocks(w);
  var seReduction = 16;
  var seChannels = Math.floor(numChannels / seReduction);

  var ctx = {
    w: w,
    numChannels: numChannels,
    numResBlocks: numResBlocks,
    seChannels: seChannels,
    boardTensor: boardTensor,
    h: null,
    step: 0,
    resBlockIdx: 0,
    policyResult: null
  };

  function nextStep() {
    try {
      var w = ctx.w;
      var numChannels = ctx.numChannels;

      switch (ctx.step) {
        case 0: {
          var conv = conv2d(ctx.boardTensor, 16, numChannels, ROWS, COLS, w["conv_init.weight"]);
          ctx.h = batchNorm2d(conv.data, numChannels, ROWS, COLS,
            w["bn_init.weight"], w["bn_init.bias"],
            w["bn_init.running_mean"], w["bn_init.running_var"]);
          relu(ctx.h);
          ctx.step = 1;
          ctx.resBlockIdx = 0;
          setTimeout(nextStep, 0);
          break;
        }

        case 1: {
          if (ctx.resBlockIdx < ctx.numResBlocks) {
            var prefix = "res_blocks." + ctx.resBlockIdx + ".";
            ctx.residual = ctx.h;

            var c1 = conv2d(ctx.h, numChannels, numChannels, ROWS, COLS, w[prefix + "conv1.weight"]);
            ctx.b1 = batchNorm2d(c1.data, numChannels, ROWS, COLS,
              w[prefix + "bn1.weight"], w[prefix + "bn1.bias"],
              w[prefix + "bn1.running_mean"], w[prefix + "bn1.running_var"]);
            relu(ctx.b1);

            ctx.step = 2;
            setTimeout(nextStep, 0);
          } else {
            ctx.step = 3;
            setTimeout(nextStep, 0);
          }
          break;
        }

        case 2: {
          var prefix = "res_blocks." + ctx.resBlockIdx + ".";
          var numChannels2 = ctx.numChannels;

          var c2 = conv2d(ctx.b1, numChannels2, numChannels2, ROWS, COLS, w[prefix + "conv2.weight"]);
          var b2 = batchNorm2d(c2.data, numChannels2, ROWS, COLS,
            w[prefix + "bn2.weight"], w[prefix + "bn2.bias"],
            w[prefix + "bn2.running_mean"], w[prefix + "bn2.running_var"]);

          if (w[prefix + "se.fc1.weight"]) {
            var seChannels2 = ctx.seChannels;
            var squeezed = new Float32Array(numChannels2);
            for (var c = 0; c < numChannels2; c++) {
              var s = 0;
              for (var i = 0; i < ROWS * COLS; i++) {
                s += b2[c * ROWS * COLS + i];
              }
              squeezed[c] = s / (ROWS * COLS);
            }
            var seFc1Out = linear(squeezed, numChannels2, seChannels2, w[prefix + "se.fc1.weight"], w[prefix + "se.fc1.bias"]);
            relu(seFc1Out);
            var seFc2Out = linear(seFc1Out, seChannels2, numChannels2, w[prefix + "se.fc2.weight"], w[prefix + "se.fc2.bias"]);
            for (var sc = 0; sc < numChannels2; sc++) {
              seFc2Out[sc] = 1.0 / (1.0 + Math.exp(-seFc2Out[sc]));
            }
            for (var sc2 = 0; sc2 < numChannels2; sc2++) {
              var scale = seFc2Out[sc2];
              for (var si = 0; si < ROWS * COLS; si++) {
                b2[sc2 * ROWS * COLS + si] *= scale;
              }
            }
          }

          for (var ri = 0; ri < ctx.h.length; ri++) {
            b2[ri] += ctx.residual[ri];
          }
          relu(b2);
          ctx.h = b2;

          ctx.resBlockIdx++;
          ctx.step = 1;
          setTimeout(nextStep, 0);
          break;
        }

        case 3: {
          var policyConv = conv2d(ctx.h, numChannels, 32, ROWS, COLS, w["policy_conv.weight"], 1, 1, 0);
          var policyBn = batchNorm2d(policyConv.data, 32, ROWS, COLS,
            w["policy_bn.weight"], w["policy_bn.bias"],
            w["policy_bn.running_mean"], w["policy_bn.running_var"]);
          relu(policyBn);
          ctx.policyResult = linear(policyBn, 32 * ROWS * COLS, 495, w["policy_fc.weight"], w["policy_fc.bias"]);

          ctx.step = 4;
          setTimeout(nextStep, 0);
          break;
        }

        case 4: {
          var valueConv = conv2d(ctx.h, numChannels, 1, ROWS, COLS, w["value_conv.weight"], 1, 1, 0);
          var valueBn = batchNorm2d(valueConv.data, 1, ROWS, COLS,
            w["value_bn.weight"], w["value_bn.bias"],
            w["value_bn.running_mean"], w["value_bn.running_var"]);
          relu(valueBn);
          var valueHidden = linear(valueBn, ROWS * COLS, 256, w["value_fc1.weight"], w["value_fc1.bias"]);
          relu(valueHidden);
          var valueRaw = linear(valueHidden, 256, 1, w["value_fc2.weight"], w["value_fc2.bias"]);
          var value = tanh(valueRaw[0]);

          callback({ policy: ctx.policyResult, value: value });
          break;
        }
      }
    } catch (e) {
      console.error("[NeuralAI] forwardPassAsync error at step " + ctx.step + ":", e);
      callback({ policy: ctx.policyResult || new Float32Array(TOTAL_ACTIONS), value: 0 });
    }
  }

  setTimeout(nextStep, 0);
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

    var legalMask = getLegalMask(pieces, player);
    var policyProbs = softmaxWithTemperature(logits, legalMask, cfg.temperature);

    var myMatBefore = countMaterial(pieces, player);
    var oppMatBefore = countMaterial(pieces, 1 - player);
    var threatBefore = _laserPressure(pieces, player) + _attackingPresence(pieces, player) * 0.35;

    var initScale = cfg.initScale * (1 + passiveTurns * 0.6);
    var tScale = cfg.tacticalScale;

    var stage1 = [];

    for (var i = 0; i < legalActions.length; i++) {
      var action = legalActions[i];
      var actionIdx = encodeAction(action, pieces);
      var policyProb = (actionIdx >= 0 && actionIdx < TOTAL_ACTIONS) ? policyProbs[actionIdx] : 0;

      var tacticalRaw = 0;
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

        tacticalRaw -= selfDamage * 8;
        tacticalRaw += oppDamage * 10;

        if (selfDamage > 0 && oppDamage === 0) {
          tacticalRaw -= selfDamage * 5;
        }

        var threatAfter = _laserPressure(newPieces, player) + _attackingPresence(newPieces, player) * 0.35;
        var threatGain = threatAfter - threatBefore;
        tacticalRaw += threatGain * initScale;

        if (action.kind === "skip") {
          tacticalRaw -= initScale * 2.0;
        }

        var oppThreat = checkOpponentLaserThreat(newPieces, player);
        tacticalRaw -= oppThreat;

        if (action.pi !== undefined && action.pi >= 0) {
          var repeatCount = 0;
          for (var h = 0; h < _moveHistory.length; h++) {
            if (_moveHistory[h] === action.pi) repeatCount++;
          }
          tacticalRaw -= repeatCount * 5.0;
        }

      } catch (e) {
        // keep policy score only
      }

      var tacticalNorm = normalizeTacticalScore(tacticalRaw, tScale);
      var tacticalShifted = (tacticalNorm + 1) * 0.5;

      var fusedScore = cfg.fusionAlpha * policyProb + (1 - cfg.fusionAlpha) * tacticalShifted;

      stage1.push({
        action: action,
        score: fusedScore,
        policyProb: policyProb,
        tacticalRaw: tacticalRaw,
        tacticalNorm: tacticalNorm,
        turnResult: turnResult
      });
    }

    stage1.sort(function(a, b) { return b.score - a.score; });

    var refineK = Math.min(cfg.refineCandidates || 5, stage1.length);
    var bestScore = -Infinity;
    var bestAction = stage1.length > 0 ? stage1[0].action : { kind: "skip" };
    var potThreatBefore = _potentialLaserThreat(pieces, player);

    for (var c = 0; c < refineK; c++) {
      var candidate = stage1[c];
      var score = candidate.score;
      var deltaTactical = 0;

      if (candidate.turnResult && candidate.turnResult.np) {
        try {
          var newPieces = candidate.turnResult.np;

          var potThreatAfter = _potentialLaserThreat(newPieces, player);
          deltaTactical = (potThreatAfter - potThreatBefore) * initScale * 0.5;

          var oppBoard = encodeBoard(newPieces, 1 - player);
          var oppResult = forwardPass(oppBoard);
          deltaTactical += -oppResult.value * cfg.valueWeight;

          var adjustedTactical = normalizeTacticalScore(candidate.tacticalRaw + deltaTactical, tScale);
          var adjustedShifted = (adjustedTactical + 1) * 0.5;
          score = cfg.fusionAlpha * candidate.policyProb + (1 - cfg.fusionAlpha) * adjustedShifted;
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
    var self = this;
    if (!_models[_difficulty]) {
      if (callback) callback(null, null);
      return;
    }

    passiveTurns = Math.min(3, Math.max(0, passiveTurns || 0));
    var cfg = NEURAL_CONFIG[_difficulty] || NEURAL_CONFIG.easy;

    var legalActions = getLegalActions(pieces, player);
    if (legalActions.length === 0) {
      if (callback) callback(null, { kind: "skip" });
      return;
    }

    var boardData = encodeBoard(pieces, player);

    forwardPassAsync(boardData, function(result) {
      try {
        var logits = result.policy;
        var legalMask = getLegalMask(pieces, player);
        var policyProbs = softmaxWithTemperature(logits, legalMask, cfg.temperature);

        var myMatBefore = countMaterial(pieces, player);
        var oppMatBefore = countMaterial(pieces, 1 - player);
        var threatBefore = _laserPressure(pieces, player) + _attackingPresence(pieces, player) * 0.35;

        var initScale = cfg.initScale * (1 + passiveTurns * 0.6);
        var tScale = cfg.tacticalScale;

        var currentPositions = {};
        for (var cp = 0; cp < pieces.length; cp++) {
          if (pieces[cp].alive) {
            currentPositions[cp] = { row: pieces[cp].row, col: pieces[cp].col };
          }
        }

        var stage1 = [];
        var evalIdx = 0;
        var BATCH_SIZE = 3;

        function evalBatch() {
          try {
            var batchEnd = Math.min(evalIdx + BATCH_SIZE, legalActions.length);

            for (; evalIdx < batchEnd; evalIdx++) {
              var action = legalActions[evalIdx];
              var actionIdx = encodeAction(action, pieces);
              var policyProb = (actionIdx >= 0 && actionIdx < TOTAL_ACTIONS) ? policyProbs[actionIdx] : 0;

              var tacticalRaw = 0;
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
                  if (callback) callback(null, action);
                  return;
                }

                if (isSuicide) continue;

                var myMatAfter = countMaterial(newPieces, player);
                var oppMatAfter = countMaterial(newPieces, 1 - player);
                var selfDamage = myMatBefore - myMatAfter;
                var oppDamage = oppMatBefore - oppMatAfter;

                tacticalRaw -= selfDamage * 8;
                tacticalRaw += oppDamage * 10;

                if (selfDamage > 0 && oppDamage === 0) {
                  tacticalRaw -= selfDamage * 5;
                }

                var threatAfter = _laserPressure(newPieces, player) + _attackingPresence(newPieces, player) * 0.35;
                var threatGain = threatAfter - threatBefore;
                tacticalRaw += threatGain * initScale;

                if (action.kind === "skip") {
                  tacticalRaw -= initScale * 2.0;
                }

                var oppThreat = checkOpponentLaserThreat(newPieces, player);
                tacticalRaw -= oppThreat;

                if (action.pi !== undefined && action.pi >= 0) {
                  var repeatCount = 0;
                  for (var h = 0; h < _moveHistory.length; h++) {
                    if (_moveHistory[h] === action.pi) repeatCount++;
                  }
                  tacticalRaw -= repeatCount * cfg.repeatPenalty;

                  if (action.kind === "move" && currentPositions[action.pi]) {
                    var origPos = currentPositions[action.pi];
                    var prevPos = _lastPositions[action.pi];
                    if (prevPos && prevPos.row === action.r && prevPos.col === action.c) {
                      tacticalRaw -= cfg.backtrackPenalty;
                    }
                  }

                  var moveCount = _pieceMoveCount[action.pi] || 0;
                  if (moveCount > 2) {
                    var otherPieces = [];
                    for (var op = 0; op < pieces.length; op++) {
                      if (op !== action.pi && pieces[op].alive && pieces[op].owner === player) {
                        otherPieces.push(op);
                      }
                    }
                    if (otherPieces.length > 0) {
                      tacticalRaw -= cfg.explorationBonus * Math.min(moveCount - 2, 3);
                    }
                  }
                }

                if (turnResult && turnResult.np) {
                  var stateHash = boardStateHash(turnResult.np);
                  var stateIdx = isInStateHistory(stateHash);
                  if (stateIdx !== -1) {
                    tacticalRaw -= cfg.repeatPenalty * (MAX_STATE_HISTORY - stateIdx) * 2;
                  }
                }

                if (action.pi !== undefined && action.pi >= 0 && _moveHistory.length > 0) {
                  var recentlyMoved = false;
                  for (var mh = 0; mh < _moveHistory.length; mh++) {
                    if (_moveHistory[mh] === action.pi) {
                      recentlyMoved = true;
                      break;
                    }
                  }
                  if (!recentlyMoved) {
                    tacticalRaw += cfg.explorationBonus * 1.5;
                  }
                }

              } catch (e) {}

              var tacticalNorm = normalizeTacticalScore(tacticalRaw, tScale);
              var tacticalShifted = (tacticalNorm + 1) * 0.5;
              var fusedScore = cfg.fusionAlpha * policyProb + (1 - cfg.fusionAlpha) * tacticalShifted;

              stage1.push({
                action: action,
                score: fusedScore,
                policyProb: policyProb,
                tacticalRaw: tacticalRaw,
                turnResult: turnResult
              });
            }

            if (evalIdx < legalActions.length) {
              setTimeout(evalBatch, 0);
            } else {
              finishChoose();
            }
          } catch (e) {
            console.error("[NeuralAI] evalBatch error:", e);
            if (callback) callback(e, null);
          }
        }

        function finishChoose() {
          stage1.sort(function(a, b) { return b.score - a.score; });

          var bestAction = stage1.length > 0 ? stage1[0].action : { kind: "skip" };

          if (bestAction.pi !== undefined) {
            _moveHistory.push(bestAction.pi);
            if (_moveHistory.length > MAX_HISTORY) _moveHistory.shift();

            _pieceMoveCount[bestAction.pi] = (_pieceMoveCount[bestAction.pi] || 0) + 1;
          }

          for (var pi in _pieceMoveCount) {
            if (_pieceMoveCount[pi] > 0) {
              _pieceMoveCount[pi]--;
            }
          }

          _lastPositions = {};
          for (var lp = 0; lp < pieces.length; lp++) {
            if (pieces[lp].alive) {
              _lastPositions[lp] = { row: pieces[lp].row, col: pieces[lp].col };
            }
          }

          if (cfg.blunder > 0 && Math.random() < cfg.blunder) {
            var safeActions = stage1.filter(function(c) { return c.turnResult !== null; });
            if (safeActions.length > 1) {
              bestAction = safeActions[Math.floor(Math.random() * safeActions.length)].action;
            }
          }

          var finalTurnResult = null;
          for (var si = 0; si < stage1.length; si++) {
            if (stage1[si].action === bestAction) {
              finalTurnResult = stage1[si].turnResult;
              break;
            }
          }
          if (finalTurnResult && finalTurnResult.np) {
            _boardStateHistory.push(boardStateHash(finalTurnResult.np));
            if (_boardStateHistory.length > MAX_STATE_HISTORY) _boardStateHistory.shift();
          }

          bestAction._value = result.value;
          if (callback) callback(null, bestAction);
        }

        setTimeout(evalBatch, 0);
      } catch (e) {
        console.error("[NeuralAI] chooseAsync error:", e);
        if (callback) callback(e, null);
      }
    });
  },

  resetHistory: function() {
    _moveHistory = [];
    _lastPositions = {};
    _pieceMoveCount = {};
    _lastActionKey = null;
    _boardStateHistory = [];
  },

  unload: function() {
    _models = { easy: null, normal: null, hard: null };
    console.log("[NeuralAI] all models unloaded");
  }
};

module.exports = NeuralAI;
