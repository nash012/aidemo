/**
 * 游戏合集 —— 微信小游戏主入口
 * 统一管理画布、主循环、触摸分发、菜单切换
 */
"use strict";

// ==================== 屏幕适配 ====================
var _sys = null;
try { _sys = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync(); }
catch (e) {
  try { _sys = wx.getSystemInfoSync(); } catch (e2) { _sys = { windowWidth: 375, windowHeight: 667, pixelRatio: 2 }; }
}
var W = _sys.windowWidth || _sys.screenWidth || 375;
var H = _sys.windowHeight || _sys.screenHeight || 667;
var DPR = Math.min(_sys.pixelRatio || 1, 2);

// 安全区域计算
var _safeTop = 20, _safeBot = 0;
var _statusBarH = 20;
{
  var _saTop = (_sys.safeArea && typeof _sys.safeArea.top === "number") ? _sys.safeArea.top : 0;
  var _sbH = (typeof _sys.statusBarHeight === "number") ? _sys.statusBarHeight : 0;
  _statusBarH = Math.max(_saTop, _sbH, 20);
  _safeTop = _statusBarH;
  if (_sys.safeArea) {
    _safeBot = Math.max((_sys.screenHeight || H) - (_sys.safeArea.bottom || H), 0);
  }
}
// 微信菜单按钮（右上角胶囊）位置是最可靠的安全区域来源
try {
  var _menuBtn = wx.getMenuButtonBoundingClientRect();
  if (_menuBtn && typeof _menuBtn.bottom === "number") {
    _safeTop = Math.max(_safeTop, _menuBtn.bottom + 4);
    console.log("[SafeArea/game.js] menuBtn.bottom=" + _menuBtn.bottom + " -> SAFE_TOP=" + _safeTop);
  }
} catch (e) {}
console.log("[SafeArea/game.js] -> SAFE_TOP=" + _safeTop + " SAFE_BOT=" + _safeBot);
var SAFE_TOP = _safeTop;
var SAFE_BOT = Math.max(_safeBot, 0);

var canvas = wx.createCanvas();
var ctx = canvas.getContext("2d");
canvas.width = Math.floor(W * DPR);
canvas.height = Math.floor(H * DPR);

// ==================== 游戏管理器 ====================
var Menu = require("./games/menu.js");
var currentModule = null;
var isInMenu = true;

// 返回按钮区域（左上角，仅避开状态栏）
var BACK_BTN = { x: 8, y: _statusBarH + 4, w: 56, h: 30 };

function createLaserGame() {
  var launchOptions = {};
  try { launchOptions = wx.getLaunchOptionsSync() || {}; } catch(e) {}
  var L = require("./games/laser/laser-game.js");
  return L.create(ctx, W, H, returnToMenu, {
    createCanvas: function(){ return wx.createCanvas(); },
    readAsset: function(assetPath, done){
      try {
        var fs = wx.getFileSystemManager();
        fs.readFile({
          filePath: assetPath,
          success: function(result){ done(null, result.data); },
          fail: function(error){ done(error || new Error("模型读取失败")); }
        });
      } catch (error) { done(error); }
    },
    dpr: DPR,
    launchOptions: launchOptions
  });
}

function returnToMenu() {
  if (currentModule && currentModule.exit) {
    try { currentModule.exit(); } catch (e) { console.error("[合集] exit error:", e); }
  }
  currentModule = createLaserGame();
  isInMenu = false;
}

function switchToGame(key) {
  if (currentModule && currentModule.exit) {
    try { currentModule.exit(); } catch (e) { console.error("[合集] exit error:", e); }
  }
  try {
    if (key === "jump") {
      var J = require("./games/jump/jump-game.js");
      currentModule = J.create(ctx, W, H, returnToMenu);
    } else if (key === "laser") {
      var L = require("./games/laser/laser-game.js");
      currentModule = L.create(ctx, W, H, returnToMenu);
    } else if (key === "pigmerge") {
      var P = require("./games/pig-merge/wrapper.js");
      currentModule = P.create(ctx, W, H, returnToMenu);
    } else {
      currentModule = Menu.create(ctx, W, H, switchToGame);
      isInMenu = true;
      return;
    }
    isInMenu = false;
  } catch (e) {
    console.error("[合集] 启动游戏失败:", key, e);
    currentModule = Menu.create(ctx, W, H, switchToGame);
    isInMenu = true;
  }
}

// 初始化 - 直接进入激光镭射象棋
currentModule = createLaserGame();
isInMenu = false;

// ==================== 触摸分发 ====================
function getTouchPos(e) {
  if (e && e.changedTouches && e.changedTouches.length > 0) {
    return { x: e.changedTouches[0].clientX, y: e.changedTouches[0].clientY };
  }
  if (e && e.touches && e.touches.length > 0) {
    return { x: e.touches[0].clientX, y: e.touches[0].clientY };
  }
  return null;
}

function hitBackBtn(x, y) {
  if (isInMenu) return false;
  if (currentModule && currentModule.showBack && !currentModule.showBack()) return false;
  return x >= BACK_BTN.x && x <= BACK_BTN.x + BACK_BTN.w &&
    y >= BACK_BTN.y && y <= BACK_BTN.y + BACK_BTN.h;
}

wx.onTouchStart(function (e) {
  var pos = getTouchPos(e);
  if (pos && hitBackBtn(pos.x, pos.y)) {
    var handled = false;
    if (currentModule && currentModule.onBack) {
      try { handled = currentModule.onBack() === true; }
      catch (err) { console.error("[合集] back:", err); }
    }
    if (!handled) returnToMenu();
    return;
  }
  if (currentModule && currentModule.onTouchStart) {
    try { currentModule.onTouchStart(e); } catch (err) { console.error("[合集] touchStart:", err); }
  }
});

wx.onTouchMove(function (e) {
  if (currentModule && currentModule.onTouchMove) {
    try { currentModule.onTouchMove(e); } catch (err) { console.error("[合集] touchMove:", err); }
  }
});

wx.onTouchEnd(function (e) {
  if (currentModule && currentModule.onTouchEnd) {
    try { currentModule.onTouchEnd(e); } catch (err) { console.error("[合集] touchEnd:", err); }
  }
});

if (wx.onTouchCancel) {
  wx.onTouchCancel(function (e) {
    if (currentModule && currentModule.onTouchEnd) {
      try { currentModule.onTouchEnd(e); } catch (err) {}
    }
  });
}

// ==================== 返回按钮绘制 ====================
function drawBackButton() {
  if (isInMenu) return;
  if (currentModule && currentModule.showBack && !currentModule.showBack()) return;
  var b = BACK_BTN;
  ctx.fillStyle = "rgba(0,0,0,0.55)";
  ctx.beginPath();
  ctx.moveTo(b.x + 8, b.y);
  ctx.arcTo(b.x + b.w, b.y, b.x + b.w, b.y + b.h, 8);
  ctx.arcTo(b.x + b.w, b.y + b.h, b.x, b.y + b.h, 8);
  ctx.arcTo(b.x, b.y + b.h, b.x, b.y, 8);
  ctx.arcTo(b.x, b.y, b.x + b.w, b.y, 8);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "#fff";
  ctx.font = "700 16px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("←", b.x + b.w / 2, b.y + b.h / 2 + 1);
}

// ==================== onShow（处理已打开小程序时点击邀请链接） ====================
if (wx.onShow) {
  wx.onShow(function (options) {
    if (currentModule && currentModule.onShow) {
      try { currentModule.onShow(options); } catch (err) { console.error("[合集] onShow:", err); }
    }
  });
}

// ==================== 主循环 ====================
var lastTime = 0;
function loop(timestamp) {
  if (lastTime === 0) lastTime = timestamp;
  var dt = (timestamp - lastTime) / 1000;
  lastTime = timestamp;
  if (dt > 0.033) dt = 0.033;
  if (dt < 0) dt = 0;

  try {
    // 每帧重置变换矩阵，确保 DPR 缩放正确
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.globalAlpha = 1;

    if (currentModule) {
      if (currentModule.update) currentModule.update(dt);
      if (currentModule.render) currentModule.render();
      drawBackButton();
    }
  } catch (e) {
    console.error("[合集] 运行异常:", e && e.message ? e.message : e);
  }

  requestAnimationFrame(loop);
}

requestAnimationFrame(loop);
