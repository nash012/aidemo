/**
 * 动物实体类
 * - 表情状态机：idle / scared / dizzy / happy / confident
 * - 挤压形变：碰撞时沿冲击方向压缩，弹性回弹
 * - 级别差异化弹性系数（低弹跳、快稳定）
 * - 下落时自动切换害怕表情
 */
var CFG = require('./config.js');

// 每级弹性系数（从配置动态生成：baseRestitution - level * restitutionDecay）
var LEVEL_RESTITUTION = [];
for (var _i = 0; _i < CFG.MAX_LEVEL; _i++) {
  LEVEL_RESTITUTION[_i] = Math.max(0.01, CFG.PHYSICS.RESTITUTION - _i * CFG.PHYSICS.RESTITUTION_DECAY);
}

// 表情枚举
var EXPR = {
  IDLE:       'idle',
  SCARED:     'scared',
  DIZZY:      'dizzy',
  HAPPY:      'happy',
  CONFIDENT:  'confident'
};

function Pig(level, x, y, scale) {
  this.level = level;
  this.scale = scale;

  var conf = CFG.PIG_LEVELS[level - 1];
  this.radius = conf.radius * scale;
  this.color = conf.color;
  this.darkColor = conf.dark;
  this.score = conf.score;

  // 物理属性
  this.mass = this.radius * this.radius * 0.01;
  this.restitution = LEVEL_RESTITUTION[level - 1];

  // 位置与速度
  this.x = x;
  this.y = y;
  this.vx = 0;
  this.vy = 0;

  // 状态标记
  this.static = true;
  this.merged = false;

  // 合成动画
  this.spawnAnim = 0;
  this.dyingAnim = 0;

  // ── 表情系统 ──
  this.expression = level >= 5 ? EXPR.CONFIDENT : EXPR.IDLE;
  this.expressionTimer = 0;
  this.fallSpeed = 0;
  this.wobble = Math.random() * Math.PI * 2;

  // ── 挤压形变 ──
  this.squishX = 1;
  this.squishY = 1;
  this.squishAngle = 0;

  // ── 旋转 ──
  this.tilt = 0;
}

Pig.prototype.drop = function () {
  this.static = false;
  this.vy = CFG.PHYSICS.DROP_VELOCITY;
};

Pig.prototype.onImpact = function (strength, nx, ny) {
  var amount = Math.min(CFG.ANIM.SQUISH_MAX, strength / 1000);
  if (amount > this.squishX - 1 + 0.05 || amount > 1 - this.squishY + 0.05) {
    var isVertical = Math.abs(ny) > Math.abs(nx);
    if (isVertical) {
      this.squishY = 1 - amount;
      this.squishX = 1 + amount * 0.55;
    } else {
      this.squishX = 1 - amount;
      this.squishY = 1 + amount * 0.55;
    }
    this.squishAngle = Math.atan2(ny, nx);
  }

  if (strength > 350 && this.expression !== EXPR.HAPPY) {
    this.expression = EXPR.DIZZY;
    this.expressionTimer = 0.2 + Math.min(0.3, strength / 3000);
  }
};

Pig.prototype.setExpression = function (expr, duration) {
  this.expression = expr;
  this.expressionTimer = duration || 0;
};

Pig.prototype.update = function (dt) {
  // 合成诞生动画（加快完成速度）
  if (this.spawnAnim < 1) {
    this.spawnAnim = Math.min(1, this.spawnAnim + dt * 8);
  }
  // 消失动画
  if (this.merged && this.dyingAnim < 1) {
    this.dyingAnim = Math.min(1, this.dyingAnim + dt * 12);
  }
  // 呼吸摆动
  this.wobble += dt * 2;

  // 挤压形变弹性回弹
  var springBack = 1 - Math.pow(0.00001, dt);
  this.squishX += (1 - this.squishX) * springBack * CFG.ANIM.SPRING_BACK_MULT;
  this.squishY += (1 - this.squishY) * springBack * CFG.ANIM.SPRING_BACK_MULT;

  // 倾斜
  var targetTilt = this.static ? 0 : Math.max(-0.25, Math.min(0.25, this.vx / CFG.ANIM.TILT_FACTOR));
  this.tilt += (targetTilt - this.tilt) * 0.15;

  // 表情状态机
  this.fallSpeed = this.static ? 0 : this.vy;

  if (this.expressionTimer > 0) {
    this.expressionTimer -= dt;
    if (this.expressionTimer <= 0) {
      this.expressionTimer = 0;
      this.expression = this.level >= 5 ? EXPR.CONFIDENT : EXPR.IDLE;
    }
  } else if (!this.static) {
    if (this.vy > CFG.ANIM.SCARED_THRESHOLD) {
      if (this.expression !== EXPR.SCARED) {
        this.expression = EXPR.SCARED;
      }
    } else if (this.vy < 50 && Math.abs(this.vx) < 30) {
      var defaultExpr = this.level >= 5 ? EXPR.CONFIDENT : EXPR.IDLE;
      if (this.expression === EXPR.SCARED) {
        this.expression = defaultExpr;
      }
    }
  }
};

Pig.prototype.getRenderScale = function () {
  if (this.merged) {
    return 1 - this.dyingAnim;
  }
  if (this.spawnAnim < 1) {
    var t = this.spawnAnim;
    var s = 1.70158;
    return 1 + (s + 1) * Math.pow(t - 1, 3) + s * Math.pow(t - 1, 2);
  }
  return 1;
};

Pig.prototype.getSquishScale = function () {
  return { sx: this.squishX, sy: this.squishY };
};

/** 判断是否已基本静止 */
Pig.prototype.isSettled = function () {
  var speedSq = this.vx * this.vx + this.vy * this.vy;
  return speedSq < CFG.ANIM.SETTLED_THRESHOLD;
};

Pig.prototype.getScareLevel = function () {
  if (this.expression !== EXPR.SCARED) return 0;
  return Math.min(1, this.fallSpeed / 600);
};

module.exports = Pig;
module.exports.EXPR = EXPR;
