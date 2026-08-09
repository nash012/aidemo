/**
 * 2D 圆形物理引擎（优化版）
 * - 按级别差异化弹性系数
 * - 切向摩擦力（堆叠更稳定）
 * - 地面附近额外阻尼（加速稳定，减少滚动时间）
 * - 碰撞冲击回调（驱动挤压形变与表情切换）
 */
var CFG = require('./config.js');

function PhysicsWorld(width, height) {
  this.width = width;
  this.height = height;
  this.gravity = CFG.PHYSICS.GRAVITY;
  this.bodies = [];
  this.collisionPairs = [];
  this.impacts = [];
}

PhysicsWorld.prototype.add = function (body) {
  this.bodies.push(body);
};

PhysicsWorld.prototype.remove = function (body) {
  var idx = this.bodies.indexOf(body);
  if (idx >= 0) this.bodies.splice(idx, 1);
};

PhysicsWorld.prototype.clear = function () {
  this.bodies.length = 0;
};

PhysicsWorld.prototype.step = function (dt) {
  this.collisionPairs.length = 0;
  this.impacts.length = 0;
  var bodies = this.bodies;
  var n = bodies.length;
  if (n === 0) return;

  var P = CFG.PHYSICS;
  var iter = P.POSITION_ITERATIONS;

  // 1. 重力 + 速度积分 + 阻尼
  for (var i = 0; i < n; i++) {
    var b = bodies[i];
    if (b.static) continue;
    b.vy += this.gravity * dt;
    var speed = Math.sqrt(b.vx * b.vx + b.vy * b.vy);
    var damp = speed > P.HIGH_SPEED_THRESHOLD ? P.HIGH_SPEED_DAMPING : P.AIR_DAMPING;
    b.vx *= damp;
    b.vy *= damp;
    b.x += b.vx * dt;
    b.y += b.vy * dt;
  }

  // 2. 墙壁 & 地面碰撞
  for (var i2 = 0; i2 < n; i2++) {
    var b2 = bodies[i2];
    if (b2.static) continue;
    var r = b2.radius;
    var wallE = b2.restitution !== undefined ? Math.min(b2.restitution * 1.2, 0.6) : P.WALL_RESTITUTION;

    // 左墙
    if (b2.x - r < 0) {
      b2.x = r;
      if (b2.vx < 0) {
        var impactL = Math.abs(b2.vx);
        b2.vx = -b2.vx * wallE;
        this._recordImpact(b2, impactL, 1, 0);
      }
    }
    // 右墙
    if (b2.x + r > this.width) {
      b2.x = this.width - r;
      if (b2.vx > 0) {
        var impactR = Math.abs(b2.vx);
        b2.vx = -b2.vx * wallE;
        this._recordImpact(b2, impactR, -1, 0);
      }
    }
    // 地面
    if (b2.y + r > this.height) {
      b2.y = this.height - r;
      if (b2.vy > 0) {
        var impactF = Math.abs(b2.vy);
        b2.vy = -b2.vy * wallE;
        b2.vx *= P.FLOOR_FRICTION;
        this._recordImpact(b2, impactF, 0, -1);
      }
      // 地面额外阻尼
      b2.vx *= P.GROUND_DAMPING;
      if (Math.abs(b2.vy) < P.GROUND_VEL_CUTOFF) b2.vy = 0;
    }
  }

  // 3. 圆-圆碰撞（多次迭代）
  for (var it = 0; it < iter; it++) {
    for (var a = 0; a < n; a++) {
      for (var bb = a + 1; bb < n; bb++) {
        this._resolvePair(bodies[a], bodies[bb], it === 0);
      }
    }
  }

  // 4. 速度休止阈值（极小速度归零，减少微抖动）
  for (var i3 = 0; i3 < n; i3++) {
    var b3 = bodies[i3];
    if (b3.static) continue;
    if (Math.abs(b3.vx) < P.VEL_SLEEP_THRESHOLD) b3.vx *= 0.5;
    if (Math.abs(b3.vy) < P.VEL_SLEEP_THRESHOLD && b3.y + b3.radius > this.height - 3) b3.vy = 0;
  }
};

PhysicsWorld.prototype._recordImpact = function (body, strength, nx, ny) {
  if (strength < 80) return;
  if (body.onImpact) {
    body.onImpact(strength, nx, ny);
  }
  this.impacts.push({ body: body, strength: strength, nx: nx, ny: ny });
};

PhysicsWorld.prototype._resolvePair = function (a, b, recordCollision) {
  if (a.static && b.static) return;

  var dx = b.x - a.x;
  var dy = b.y - a.y;
  var distSq = dx * dx + dy * dy;
  var minDist = a.radius + b.radius;

  if (distSq >= minDist * minDist) return;

  var dist = Math.sqrt(distSq);
  if (dist === 0) { dx = 1; dy = 0; dist = 1; }

  var nx = dx / dist;
  var ny = dy / dist;
  var overlap = minDist - dist;

  var slop = CFG.PHYSICS.COLLISION_SLOP;
  var totalInvMass = (a.static ? 0 : 1 / a.mass) + (b.static ? 0 : 1 / b.mass);
  if (totalInvMass === 0) return;

  var correction = Math.max(overlap - slop, 0) * CFG.PHYSICS.POSITION_CORRECTION / totalInvMass;
  if (!a.static) {
    a.x -= nx * correction / a.mass;
    a.y -= ny * correction / a.mass;
  }
  if (!b.static) {
    b.x += nx * correction / b.mass;
    b.y += ny * correction / b.mass;
  }

  var dvx = b.vx - a.vx;
  var dvy = b.vy - a.vy;
  var velAlongNormal = dvx * nx + dvy * ny;
  if (velAlongNormal > 0) return;

  var eA = a.restitution !== undefined ? a.restitution : CFG.PHYSICS.RESTITUTION;
  var eB = b.restitution !== undefined ? b.restitution : CFG.PHYSICS.RESTITUTION;
  var e = Math.min(eA, eB);

  var j = -(1 + e) * velAlongNormal / totalInvMass;

  var impactStrength = Math.abs(velAlongNormal);
  if (recordCollision && impactStrength > 80) {
    if (!a.static && a.onImpact) a.onImpact(impactStrength, -nx, -ny);
    if (!b.static && b.onImpact) b.onImpact(impactStrength, nx, ny);
  }

  if (!a.static) {
    a.vx -= (j / a.mass) * nx;
    a.vy -= (j / a.mass) * ny;
  }
  if (!b.static) {
    b.vx += (j / b.mass) * nx;
    b.vy += (j / b.mass) * ny;
  }

  // 切向摩擦力
  var tx = -ny;
  var ty = nx;
  var velAlongTangent = dvx * tx + dvy * ty;
  var friction = CFG.PHYSICS.TANGENTIAL_FRICTION;
  var jt = -velAlongTangent * friction / totalInvMass;

  if (!a.static) {
    a.vx -= (jt / a.mass) * tx;
    a.vy -= (jt / a.mass) * ty;
  }
  if (!b.static) {
    b.vx += (jt / b.mass) * tx;
    b.vy += (jt / b.mass) * ty;
  }

  // 记录同级别碰撞对（供合成检测）
  // 排除：已合成、静态（待下落）、达到最高级别
  // 同级别碰撞立即合成，无视动画状态
  if (recordCollision && a.level === b.level && !a.merged && !b.merged &&
      a.level < CFG.MAX_LEVEL &&
      !a.static && !b.static) {
    this.collisionPairs.push({ a: a, b: b });
  }
};

module.exports = PhysicsWorld;
