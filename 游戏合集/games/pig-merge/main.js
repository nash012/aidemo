/**
 * 主游戏逻辑
 * 管理游戏状态机、触摸输入、物理更新、合成检测、计分、游戏结束等核心流程
 */
var CFG = require('./config.js');
var PhysicsWorld = require('./physics.js');
var Pig = require('./pig.js');
var EffectManager = require('./effects.js');
var Renderer = require('./renderer.js');

// 游戏状态
var STATE = { READY: 0, PLAYING: 1, GAME_OVER: 2 };

/**
 * @param {HTMLCanvasElement} canvas  微信小游戏 Canvas
 * @param {number} screenWidth   逻辑宽度
 * @param {number} screenHeight  逻辑高度
 */
function Game(canvas, screenWidth, screenHeight) {
  this.canvas = canvas;
  this.ctx = canvas.getContext('2d');
  this.width = screenWidth;
  this.height = screenHeight;
  this.scale = screenWidth / CFG.BASE_WIDTH;

  // 子系统
  this.physics = new PhysicsWorld(screenWidth, screenHeight);
  this.effects = new EffectManager();
  this.renderer = new Renderer(this.ctx, screenWidth, screenHeight, this.scale);

  // 游戏状态
  this.state = STATE.READY;
  this.score = 0;
  this.bestScore = this._loadBestScore();
  this.isNewBest = false;

  // 当前待下落猪猪
  this.currentPig = null;
  this.nextLevel = this._randomLevel();
  // 下落后的生成延迟计时器
  this.spawnTimer = 0;
  // 猪猪是否已下落（等待生成下一个）
  this.pigDropped = false;

  // 触摸
  this.touching = false;
  this.touchX = screenWidth / 2;

  // 危险计时（猪猪超过栅栏线）
  this.dangerTimer = 0;

  // 待移除的已合成猪猪
  this._removeQueue = [];

  this._spawnCurrentPig();
}

// ── 游戏循环 ──────────────────────────────────────

Game.prototype.update = function (dt) {
  if (this.state === STATE.PLAYING) {
    this._updatePlaying(dt);
  }
  // 特效在任何状态都更新（让结束画面粒子消散）
  this.effects.update(dt);
  // 更新渲染器全局动画时间（汗珠跳动、眩晕星星旋转等）
  this.renderer.tick(dt);
};

Game.prototype._updatePlaying = function (dt) {
  var substeps = CFG.PHYSICS.SUBSTEPS;
  var subDt = dt / substeps;

  // 物理子步进
  for (var i = 0; i < substeps; i++) {
    this.physics.step(subDt);
  }

  // 合成检测
  this._checkMerges();

  // 清理已合成的猪猪
  this._cleanupMerged();

  // 更新所有猪猪动画（跳过当前待下落猪猪，避免双重更新）
  var bodies = this.physics.bodies;
  for (var j = 0; j < bodies.length; j++) {
    if (bodies[j] === this.currentPig) continue;
    bodies[j].update(dt);
  }

  // 更新当前待下落猪猪位置
  if (this.currentPig && this.currentPig.static) {
    var targetX = this.touching ? this.touchX : this.currentPig.x;
    // 平滑跟随手指
    this.currentPig.x += (targetX - this.currentPig.x) * 0.3;
    // 限制在墙壁内
    var r = this.currentPig.radius;
    this.currentPig.x = Math.max(r, Math.min(this.width - r, this.currentPig.x));
    this.currentPig.update(dt);
  }

  // 生成下一个猪猪（需等待猪猪稳定或动画完成）
  if (this.pigDropped) {
    this.spawnTimer += dt;
    var minWaitReached = this.spawnTimer >= CFG.LAYOUT.SPAWN_DELAY;
    var maxWaitReached = this.spawnTimer >= 2.5;
    var allSettled = this._allPigsSettled();

    if (minWaitReached && (allSettled || maxWaitReached)) {
      this.pigDropped = false;
      this.spawnTimer = 0;
      this._spawnCurrentPig();
    }
  }

  // 游戏结束检测
  this._checkGameOver(dt);
};

// ── 合成 ──────────────────────────────────────────

Game.prototype._checkMerges = function () {
  var pairs = this.physics.collisionPairs;
  if (pairs.length === 0) return;

  for (var i = 0; i < pairs.length; i++) {
    var pair = pairs[i];
    var a = pair.a;
    var b = pair.b;

    // 安全检查：跳过无效引用
    if (!a || !b) continue;
    // 跳过已标记合成的
    if (a.merged || b.merged) continue;
    // 跳过不同级别
    if (a.level !== b.level) continue;
    // 跳过最高级别（无法再合成）
    if (a.level >= CFG.MAX_LEVEL) continue;
    // 防止当前待下落猪猪被合成
    if (a === this.currentPig || b === this.currentPig) continue;

    // 标记合成
    a.merged = true;
    b.merged = true;

    // 计算新猪猪属性
    var newLevel = a.level + 1;
    var midX = (a.x + b.x) / 2;
    var midY = (a.y + b.y) / 2;

    // 从物理世界移除旧猪猪
    this.physics.remove(a);
    this.physics.remove(b);

    // 创建新猪猪
    var newPig = new Pig(newLevel, midX, midY, this.scale);
    newPig.static = false;
    newPig.vy = Math.min(a.vy, b.vy) * 0.5; // 继承部分速度
    newPig.vx = (a.vx + b.vx) * 0.3;
    newPig.spawnAnim = 0; // 触发诞生动画
    newPig.setExpression('happy', 0.5); // 合成诞生 → 开心表情

    this.physics.add(newPig);

    // 计分
    var gain = CFG.PIG_LEVELS[newLevel - 1].score;
    this.score += gain;

    // 特效
    this.effects.burst(midX, midY, newPig.color, 10 + newLevel * 2);
    this.effects.popup(midX, midY - newPig.radius, gain, this.scale);
  }
};

Game.prototype._cleanupMerged = function () {
  // merged 猪猪已在 _checkMerges 中从物理世界移除
  // 此处无需额外操作，保留以防未来扩展
};

/** 检查所有猪猪是否已稳定（速度足够小且合成动画已完成） */
Game.prototype._allPigsSettled = function () {
  var bodies = this.physics.bodies;
  for (var i = 0; i < bodies.length; i++) {
    var b = bodies[i];
    if (b.static) continue;   // 跳过待下落猪猪
    if (b.merged) continue;   // 跳过已合成猪猪
    if (!b.isSettled()) return false;        // 速度仍较大
    if (b.spawnAnim < 1) return false;       // 合成诞生动画未完成
  }
  return true;
};

// ── 游戏结束检测 ──────────────────────────────────

Game.prototype._checkGameOver = function (dt) {
  var fenceY = this.renderer.fenceY;
  var bodies = this.physics.bodies;
  var anyAbove = false;

  for (var i = 0; i < bodies.length; i++) {
    var p = bodies[i];
    if (p.static) continue;          // 忽略待下落猪猪
    if (p.spawnAnim < 0.5) continue; // 刚合成的猪猪给点缓冲

    // 猪猪顶部超过栅栏线
    if (p.y - p.radius < fenceY) {
      // 且速度较小（已基本稳定）
      if (p.isSettled()) {
        anyAbove = true;
        break;
      }
    }
  }

  if (anyAbove) {
    this.dangerTimer += dt;
    if (this.dangerTimer >= CFG.LAYOUT.DANGER_TIME) {
      this._gameOver();
    }
  } else {
    // 危险解除，缓慢减少计时
    this.dangerTimer = Math.max(0, this.dangerTimer - dt * 2);
  }
};

// ── 生成猪猪 ──────────────────────────────────────

Game.prototype._randomLevel = function () {
  return CFG.MIN_SPAWN_LEVEL + Math.floor(Math.random() * (CFG.MAX_SPAWN_LEVEL - CFG.MIN_SPAWN_LEVEL + 1));
};

Game.prototype._spawnCurrentPig = function () {
  var level = this.nextLevel;
  this.nextLevel = this._randomLevel();

  var spawnY = this.renderer.fenceY - this.height * CFG.LAYOUT.SPAWN_OFFSET -
    CFG.PIG_LEVELS[level - 1].radius * this.scale;

  this.currentPig = new Pig(level, this.width / 2, spawnY, this.scale);
  this.currentPig.static = true;
  this.physics.add(this.currentPig);
};

// ── 下落 ──────────────────────────────────────────

Game.prototype._dropPig = function () {
  if (!this.currentPig || !this.currentPig.static) return;
  this.currentPig.drop();
  this.currentPig = null;
  this.pigDropped = true;
  this.spawnTimer = 0;
};

// ── 游戏结束 ──────────────────────────────────────

Game.prototype._gameOver = function () {
  this.state = STATE.GAME_OVER;
  this.isNewBest = this.score > this.bestScore;
  if (this.isNewBest) {
    this.bestScore = this.score;
    this._saveBestScore(this.bestScore);
  }
};

// ── 重新开始 ──────────────────────────────────────

Game.prototype.restart = function () {
  this.physics.clear();
  this.effects.clear();
  this.score = 0;
  this.isNewBest = false;
  this.dangerTimer = 0;
  this.currentPig = null;
  this.pigDropped = false;
  this.spawnTimer = 0;
  this.nextLevel = this._randomLevel();
  this.state = STATE.PLAYING;
  this._spawnCurrentPig();
};

// ── 触摸处理 ──────────────────────────────────────

// 触摸事件由外部 wrapper 调用，不再直接绑定 wx.onTouch*

Game.prototype.onTouchStart = function (e) {
  if (!e || !e.touches || e.touches.length === 0) return;
  var t = e.touches[0];
  this.touchX = t.clientX;
  this.touching = true;

  if (this.state === STATE.READY) {
    // 检测点击开始按钮
    if (this._hitStartButton(t.clientX, t.clientY)) {
      this.state = STATE.PLAYING;
    }
  } else if (this.state === STATE.GAME_OVER) {
    // 检测点击重新开始按钮
    if (this._hitRestartButton(t.clientX, t.clientY)) {
      this.restart();
    }
  }
  // PLAYING 状态下触摸即开始瞄准
};

Game.prototype.onTouchMove = function (e) {
  if (!e || !e.touches || e.touches.length === 0) return;
  this.touchX = e.touches[0].clientX;
};

Game.prototype.onTouchEnd = function () {
  this.touching = false;
  if (this.state === STATE.PLAYING && this.currentPig && this.currentPig.static) {
    this._dropPig();
  }
};

Game.prototype._hitStartButton = function (x, y) {
  var btnW = 180 * this.scale;
  var btnH = 50 * this.scale;
  var btnX = (this.width - btnW) / 2;
  var btnY = this.height * 0.68;
  return x >= btnX && x <= btnX + btnW && y >= btnY && y <= btnY + btnH;
};

Game.prototype._hitRestartButton = function (x, y) {
  var btnW = 180 * this.scale;
  var btnH = 50 * this.scale;
  var btnX = (this.width - btnW) / 2;
  var btnY = this.height * 0.64;
  return x >= btnX && x <= btnX + btnW && y >= btnY && y <= btnY + btnH;
};

// ── 渲染 ──────────────────────────────────────────

Game.prototype.render = function () {
  var r = this.renderer;
  r.drawBackground();

  if (this.state === STATE.READY) {
    r.drawStartScreen();
    return;
  }

  // 栅栏状态
  var fenceState = 'normal';
  var dangerProgress = 0;
  if (this.state === STATE.PLAYING && this.dangerTimer > 0) {
    dangerProgress = this.dangerTimer / CFG.LAYOUT.DANGER_TIME;
    fenceState = dangerProgress > 0.5 ? 'danger' : 'warn';
  }

  // 已落下的猪猪
  var bodies = this.physics.bodies;
  for (var i = 0; i < bodies.length; i++) {
    if (bodies[i] === this.currentPig) continue;
    r.drawPig(bodies[i], false);
  }

  // 待下落猪猪（最上层）
  if (this.currentPig && this.currentPig.static) {
    r.drawPig(this.currentPig, true);
  }

  // 特效
  this.effects.render(this.ctx);

  // 栅栏（画在猪猪上方）
  r.drawFence(fenceState, dangerProgress);

  // UI
  if (this.state === STATE.PLAYING) {
    r.drawUI(this.score, this.bestScore, this.nextLevel);
  }

  // 游戏结束
  if (this.state === STATE.GAME_OVER) {
    r.drawGameOver(this.score, this.bestScore, this.isNewBest);
  }
};

// ── 存档 ──────────────────────────────────────────

Game.prototype._loadBestScore = function () {
  try {
    var v = wx.getStorageSync('pigMergeBestScore');
    return v ? parseInt(v, 10) : 0;
  } catch (e) {
    return 0;
  }
};

Game.prototype._saveBestScore = function (score) {
  try {
    wx.setStorageSync('pigMergeBestScore', score.toString());
  } catch (e) {
    // 忽略存储失败
  }
};

module.exports = Game;
