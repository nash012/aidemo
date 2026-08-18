/**
 * 特效系统
 * 管理合成粒子效果和分数弹出文字
 */
var CFG = require('./config.js');

// ── 粒子 ──────────────────────────────────────────

function Particle(x, y, color) {
  this.x = x;
  this.y = y;
  var angle = Math.random() * Math.PI * 2;
  var speed = 80 + Math.random() * 200;
  this.vx = Math.cos(angle) * speed;
  this.vy = Math.sin(angle) * speed - 80; // 略微向上
  this.life = 1.0;
  this.maxLife = 0.5 + Math.random() * 0.3;
  this.size = 3 + Math.random() * 5;
  this.color = color;
}

Particle.prototype.update = function (dt) {
  this.x += this.vx * dt;
  this.y += this.vy * dt;
  this.vy += 600 * dt;   // 粒子受重力
  this.vx *= 0.96;
  this.life -= dt / this.maxLife;
  return this.life > 0;
};

// ── 分数弹出 ──────────────────────────────────────

function ScorePopup(x, y, score, scale) {
  this.x = x;
  this.y = y;
  this.startY = y;
  this.score = score;
  this.life = 1.0;
  this.maxLife = 1.0;
  this.scale = scale;
}

ScorePopup.prototype.update = function (dt) {
  this.y -= 60 * dt; // 向上飘
  this.life -= dt / this.maxLife;
  return this.life > 0;
};

// ── 特效管理器 ────────────────────────────────────

function EffectManager() {
  this.particles = [];
  this.popups = [];
}

/** 触发合成爆炸粒子 */
EffectManager.prototype.burst = function (x, y, color, count) {
  count = count || 12;
  var palette = [color].concat(CFG.COLORS.PARTICLE);
  for (var i = 0; i < count; i++) {
    var c = palette[Math.floor(Math.random() * palette.length)];
    this.particles.push(new Particle(x, y, c));
  }
};

/** 触发分数弹出 */
EffectManager.prototype.popup = function (x, y, score, scale) {
  this.popups.push(new ScorePopup(x, y, score, scale));
};

/** 更新所有特效 */
EffectManager.prototype.update = function (dt) {
  // 粒子
  for (var i = this.particles.length - 1; i >= 0; i--) {
    if (!this.particles[i].update(dt)) {
      this.particles.splice(i, 1);
    }
  }
  // 弹出文字
  for (var j = this.popups.length - 1; j >= 0; j--) {
    if (!this.popups[j].update(dt)) {
      this.popups.splice(j, 1);
    }
  }
};

/** 渲染所有特效 */
EffectManager.prototype.render = function (ctx) {
  // 粒子
  for (var i = 0; i < this.particles.length; i++) {
    var p = this.particles[i];
    var alpha = Math.max(0, p.life);
    ctx.globalAlpha = alpha;
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.size * alpha, 0, Math.PI * 2);
    ctx.fill();
  }
  // 弹出文字
  for (var j = 0; j < this.popups.length; j++) {
    var s = this.popups[j];
    var a = Math.max(0, s.life);
    ctx.globalAlpha = a;
    ctx.fillStyle = '#FFD700';
    ctx.font = 'bold ' + Math.round(22 * s.scale) + 'px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('+' + s.score, s.x, s.y);
  }
  ctx.globalAlpha = 1;
};

/** 清空所有特效 */
EffectManager.prototype.clear = function () {
  this.particles.length = 0;
  this.popups.length = 0;
};

module.exports = EffectManager;
