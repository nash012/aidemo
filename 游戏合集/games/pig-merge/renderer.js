/**
 * 渲染器（西游合成版）
 * - 10 级西游记角色：小妖→白骨精→蜘蛛精→沙悟净→猪八戒→孙悟空→观音菩萨→如来佛祖→玉皇大帝→盘古
 * - 5 种表情：idle / scared / dizzy / happy / confident
 * - 碰撞挤压形变 + 速度倾斜
 * - 下落害怕表情：大眼+张嘴+汗珠
 * - 高级别满足感：自信眼神+特殊装饰
 */
var CFG = require('./config.js');

function Renderer(ctx, width, height, scale) {
  this.ctx = ctx;
  this.width = width;
  this.height = height;
  this.scale = scale;
  this.fenceY = height * CFG.LAYOUT.FENCE_RATIO;
  this._time = 0;
}

// ── 工具 ──────────────────────────────────────────

function shadeColor(hex, percent) {
  var num = parseInt(hex.slice(1), 16);
  var r = (num >> 16) & 0xff;
  var g = (num >> 8) & 0xff;
  var b = num & 0xff;
  r = Math.max(0, Math.min(255, r + Math.round(r * percent / 100)));
  g = Math.max(0, Math.min(255, g + Math.round(g * percent / 100)));
  b = Math.max(0, Math.min(255, b + Math.round(b * percent / 100)));
  return 'rgb(' + r + ',' + g + ',' + b + ')';
}

Renderer.prototype.tick = function (dt) {
  this._time += dt;
};

Renderer.prototype.drawBackground = function () {
  var ctx = this.ctx;
  var grad = ctx.createLinearGradient(0, 0, 0, this.height);
  grad.addColorStop(0, CFG.COLORS.BG_TOP);
  grad.addColorStop(1, CFG.COLORS.BG_BOTTOM);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, this.width, this.height);
};

Renderer.prototype.drawFence = function (state, dangerProgress) {
  var ctx = this.ctx;
  var y = this.fenceY;
  var color = CFG.COLORS.FENCE;
  if (state === 'warn') color = CFG.COLORS.FENCE_WARN;
  if (state === 'danger') color = CFG.COLORS.FENCE_DANGER;

  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 2 * this.scale;
  ctx.setLineDash([12 * this.scale, 8 * this.scale]);
  ctx.beginPath();
  ctx.moveTo(0, y);
  ctx.lineTo(this.width, y);
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(0, y, 4 * this.scale, 0, Math.PI * 2);
  ctx.arc(this.width, y, 4 * this.scale, 0, Math.PI * 2);
  ctx.fill();

  if (dangerProgress > 0) {
    ctx.fillStyle = 'rgba(255, 68, 68, ' + (0.2 + dangerProgress * 0.3) + ')';
    ctx.fillRect(0, 0, this.width, y);
  }
  ctx.restore();
};

// ════════════════════════════════════════════════════
//  角色绘制（核心）
// ════════════════════════════════════════════════════

Renderer.prototype.drawPig = function (pig, isPreview) {
  var ctx = this.ctx;
  var s = pig.getRenderScale();
  if (s <= 0) return;

  var r = pig.radius * s;
  var squish = pig.getSquishScale();
  var x = pig.x;
  var y = pig.y;

  var breath = 1;
  if (!isPreview && !pig.static) {
    breath = 1 + Math.sin(pig.wobble) * 0.02;
  }
  r *= breath;

  if (isPreview) {
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.15)';
    ctx.lineWidth = 2 * this.scale;
    ctx.setLineDash([4 * this.scale, 4 * this.scale]);
    ctx.beginPath();
    ctx.moveTo(x, y + r);
    ctx.lineTo(x, this.height);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }

  if (!isPreview) {
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.2)';
    ctx.beginPath();
    ctx.ellipse(x, y + r * 0.85, r * 0.75 * squish.sx, r * 0.12, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // 背景装饰（观音莲花瓣、佛祖光环、玉帝祥云、盘古混沌）
  if (pig.level === 7) this._drawLotusPetals(x, y, r, pig.tilt);
  if (pig.level === 8) this._drawBuddhaAura(x, y, r, pig.tilt);
  if (pig.level === 9) this._drawImperialAura(x, y, r, pig.tilt);
  if (pig.level === 10) this._drawChaosSwirl(x, y, r, pig.tilt);

  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(pig.tilt);
  ctx.scale(squish.sx, squish.sy);

  this._drawBody(r, pig);
  this._drawEars(r, pig);
  this._drawFace(r, pig);
  this._drawAccessory(r, pig);

  if (pig.expression === 'scared') this._drawSweat(r, pig.getScareLevel());
  if (pig.expression === 'dizzy') this._drawDizzyStars(r);

  ctx.restore();
};

// ── 身体 ──────────────────────────────────────────

Renderer.prototype._drawBody = function (r, pig) {
  var ctx = this.ctx;
  var grad = ctx.createRadialGradient(-r * 0.3, -r * 0.3, r * 0.1, 0, 0, r);
  grad.addColorStop(0, shadeColor(pig.color, 25));
  grad.addColorStop(0.7, pig.color);
  grad.addColorStop(1, pig.darkColor);
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fill();

  // 高光
  ctx.fillStyle = 'rgba(255,255,255,0.2)';
  ctx.beginPath();
  ctx.ellipse(-r * 0.3, -r * 0.35, r * 0.25, r * 0.15, -0.5, 0, Math.PI * 2);
  ctx.fill();

  // ── 级别专属身体标记 ──
  if (pig.level === 1) {
    // 小妖：腹部深色条纹
    ctx.fillStyle = shadeColor(pig.darkColor, -10);
    ctx.beginPath();
    ctx.ellipse(0, r * 0.3, r * 0.35, r * 0.22, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  if (pig.level === 2) {
    // 白骨精：肋骨纹路
    ctx.strokeStyle = shadeColor(pig.darkColor, -15);
    ctx.lineWidth = r * 0.03;
    for (var bi = 0; bi < 4; bi++) {
      ctx.beginPath();
      ctx.moveTo(-r * 0.2 + bi * r * 0.12, r * 0.05);
      ctx.lineTo(-r * 0.2 + bi * r * 0.12, r * 0.35);
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.moveTo(-r * 0.2, r * 0.2);
    ctx.lineTo(r * 0.2, r * 0.2);
    ctx.stroke();
  }

  if (pig.level === 3) {
    // 蜘蛛精：蛛网纹
    ctx.strokeStyle = shadeColor(pig.darkColor, -5);
    ctx.lineWidth = r * 0.02;
    for (var wi = 0; wi < 6; wi++) {
      var wa = wi * Math.PI / 3;
      ctx.beginPath();
      ctx.moveTo(0, r * 0.2);
      ctx.lineTo(Math.cos(wa) * r * 0.4, r * 0.2 + Math.sin(wa) * r * 0.25);
      ctx.stroke();
    }
    for (var ring = 1; ring <= 2; ring++) {
      ctx.beginPath();
      ctx.arc(0, r * 0.2, r * 0.15 * ring, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  if (pig.level === 4) {
    // 沙悟净：僧袍V领
    ctx.fillStyle = shadeColor(pig.color, -15);
    ctx.beginPath();
    ctx.moveTo(0, -r * 0.1);
    ctx.lineTo(-r * 0.4, r * 0.5);
    ctx.lineTo(r * 0.4, r * 0.5);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#8B4513';
    ctx.beginPath();
    ctx.ellipse(0, r * 0.5, r * 0.12, r * 0.06, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  if (pig.level === 5) {
    // 猪八戒：大肚皮
    ctx.fillStyle = shadeColor(pig.color, 20);
    ctx.beginPath();
    ctx.ellipse(0, r * 0.3, r * 0.5, r * 0.38, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = shadeColor(pig.darkColor, -10);
    ctx.beginPath();
    ctx.arc(0, r * 0.3, r * 0.04, 0, Math.PI * 2);
    ctx.fill();
  }

  if (pig.level === 6) {
    // 孙悟空：虎皮裙纹
    ctx.fillStyle = '#FF8800';
    ctx.beginPath();
    ctx.ellipse(0, r * 0.35, r * 0.45, r * 0.2, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#3a2a1a';
    for (var si = 0; si < 4; si++) {
      ctx.beginPath();
      ctx.ellipse(-r * 0.3 + si * r * 0.2, r * 0.35, r * 0.04, r * 0.08, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  if (pig.level === 7) {
    // 观音菩萨：白色衣袍
    ctx.fillStyle = 'rgba(255,255,255,0.3)';
    ctx.beginPath();
    ctx.ellipse(0, r * 0.3, r * 0.45, r * 0.3, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,215,0,0.5)';
    ctx.lineWidth = r * 0.02;
    ctx.beginPath();
    ctx.arc(0, r * 0.3, r * 0.3, 0.2 * Math.PI, 0.8 * Math.PI);
    ctx.stroke();
  }

  if (pig.level === 8) {
    // 如来佛祖：金色袈裟纹
    ctx.fillStyle = shadeColor(pig.color, -5);
    ctx.beginPath();
    ctx.ellipse(0, r * 0.3, r * 0.5, r * 0.32, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,200,0.6)';
    ctx.lineWidth = r * 0.02;
    for (var qi = 0; qi < 5; qi++) {
      var qx = -r * 0.35 + qi * r * 0.18;
      ctx.beginPath();
      ctx.moveTo(qx, r * 0.1);
      ctx.lineTo(qx, r * 0.5);
      ctx.stroke();
    }
  }

  if (pig.level === 9) {
    // 玉皇大帝：龙袍纹饰
    ctx.fillStyle = shadeColor(pig.color, -10);
    ctx.beginPath();
    ctx.ellipse(0, r * 0.3, r * 0.5, r * 0.35, 0, 0, Math.PI * 2);
    ctx.fill();
    // 龙纹
    ctx.strokeStyle = 'rgba(255,255,200,0.5)';
    ctx.lineWidth = r * 0.03;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-r * 0.3, r * 0.15);
    ctx.quadraticCurveTo(-r * 0.1, r * 0.05, r * 0.1, r * 0.2);
    ctx.quadraticCurveTo(r * 0.3, r * 0.35, r * 0.3, r * 0.45);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-r * 0.3, r * 0.4);
    ctx.quadraticCurveTo(-r * 0.15, r * 0.3, 0, r * 0.45);
    ctx.stroke();
    ctx.lineCap = 'butt';
    // 云纹
    ctx.fillStyle = 'rgba(255,255,255,0.3)';
    ctx.beginPath();
    ctx.arc(-r * 0.25, r * 0.1, r * 0.06, 0, Math.PI * 2);
    ctx.arc(r * 0.25, r * 0.1, r * 0.06, 0, Math.PI * 2);
    ctx.fill();
  }

  if (pig.level === 10) {
    // 盘古：混沌星辰体
    ctx.fillStyle = shadeColor(pig.darkColor, -15);
    ctx.beginPath();
    ctx.ellipse(0, r * 0.3, r * 0.5, r * 0.35, 0, 0, Math.PI * 2);
    ctx.fill();
    // 星辰
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    for (var sti = 0; sti < 6; sti++) {
      var sang = sti * Math.PI / 3;
      var ssx = Math.cos(sang) * r * 0.3;
      var ssy = r * 0.3 + Math.sin(sang) * r * 0.18;
      ctx.beginPath();
      ctx.arc(ssx, ssy, r * 0.03, 0, Math.PI * 2);
      ctx.fill();
    }
    // 混沌漩涡
    ctx.strokeStyle = 'rgba(200,180,255,0.4)';
    ctx.lineWidth = r * 0.02;
    ctx.beginPath();
    ctx.arc(0, r * 0.3, r * 0.15, 0, Math.PI * 1.5);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, r * 0.3, r * 0.25, Math.PI * 0.5, Math.PI * 2);
    ctx.stroke();
  }

  // 腮红（低级别）
  if (pig.level <= 3) {
    ctx.fillStyle = 'rgba(200,100,130,0.25)';
    ctx.beginPath();
    ctx.arc(-r * 0.45, r * 0.05, r * 0.12, 0, Math.PI * 2);
    ctx.arc(r * 0.45, r * 0.05, r * 0.12, 0, Math.PI * 2);
    ctx.fill();
  }
};

// ── 耳朵 / 角（10 种角色各不同） ───────────────────

Renderer.prototype._drawEars = function (r, pig) {
  var ctx = this.ctx;
  var lv = pig.level;

  if (lv === 1) {
    // 小妖：弯角恶魔角
    ctx.fillStyle = shadeColor(pig.darkColor, -10);
    ctx.beginPath();
    ctx.moveTo(-r * 0.4, -r * 0.7);
    ctx.quadraticCurveTo(-r * 0.6, -r * 1.1, -r * 0.25, -r * 1.0);
    ctx.quadraticCurveTo(-r * 0.2, -r * 0.85, -r * 0.35, -r * 0.7);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(r * 0.4, -r * 0.7);
    ctx.quadraticCurveTo(r * 0.6, -r * 1.1, r * 0.25, -r * 1.0);
    ctx.quadraticCurveTo(r * 0.2, -r * 0.85, r * 0.35, -r * 0.7);
    ctx.closePath();
    ctx.fill();

  } else if (lv === 2) {
    // 白骨精：骨质尖刺
    ctx.fillStyle = shadeColor(pig.color, -5);
    ctx.beginPath();
    ctx.moveTo(-r * 0.45, -r * 0.65);
    ctx.lineTo(-r * 0.5, -r * 1.15);
    ctx.lineTo(-r * 0.3, -r * 0.7);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(r * 0.45, -r * 0.65);
    ctx.lineTo(r * 0.5, -r * 1.15);
    ctx.lineTo(r * 0.3, -r * 0.7);
    ctx.closePath();
    ctx.fill();
    // 骨刺高光
    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    ctx.beginPath();
    ctx.moveTo(-r * 0.42, -r * 0.7);
    ctx.lineTo(-r * 0.45, -r * 1.05);
    ctx.lineTo(-r * 0.38, -r * 0.75);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(r * 0.42, -r * 0.7);
    ctx.lineTo(r * 0.45, -r * 1.05);
    ctx.lineTo(r * 0.38, -r * 0.75);
    ctx.closePath();
    ctx.fill();

  } else if (lv === 3) {
    // 蜘蛛精：蛛腿触角
    ctx.strokeStyle = shadeColor(pig.darkColor, -5);
    ctx.lineWidth = r * 0.04;
    ctx.lineCap = 'round';
    for (var si = 0; si < 3; si++) {
      var ox = -r * 0.4 + si * r * 0.4;
      ctx.beginPath();
      ctx.moveTo(ox, -r * 0.85);
      ctx.quadraticCurveTo(ox + r * 0.1, -r * 1.15, ox + r * 0.05, -r * 1.25);
      ctx.stroke();
    }
    ctx.lineCap = 'butt';

  } else if (lv === 4) {
    // 沙悟净：大鬓角 + 戒疤点
    ctx.fillStyle = shadeColor(pig.darkColor, -15);
    ctx.beginPath();
    ctx.ellipse(-r * 0.75, -r * 0.2, r * 0.18, r * 0.4, -0.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(r * 0.75, -r * 0.2, r * 0.18, r * 0.4, 0.2, 0, Math.PI * 2);
    ctx.fill();
    // 戒疤
    ctx.fillStyle = '#8B4513';
    for (var di = 0; di < 3; di++) {
      ctx.beginPath();
      ctx.arc(-r * 0.12 + di * r * 0.12, -r * 0.78, r * 0.03, 0, Math.PI * 2);
      ctx.fill();
    }

  } else if (lv === 5) {
    // 猪八戒：大扇风耳
    ctx.fillStyle = shadeColor(pig.color, -8);
    ctx.beginPath();
    ctx.ellipse(-r * 0.85, -r * 0.1, r * 0.2, r * 0.4, -0.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(r * 0.85, -r * 0.1, r * 0.2, r * 0.4, 0.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = shadeColor(pig.color, -20);
    ctx.beginPath();
    ctx.ellipse(-r * 0.82, -r * 0.1, r * 0.1, r * 0.25, -0.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(r * 0.82, -r * 0.1, r * 0.1, r * 0.25, 0.3, 0, Math.PI * 2);
    ctx.fill();

  } else if (lv === 6) {
    // 孙悟空：猴耳 + 金箍
    ctx.fillStyle = shadeColor(pig.color, -10);
    ctx.beginPath();
    ctx.ellipse(-r * 0.7, -r * 0.3, r * 0.15, r * 0.22, -0.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(r * 0.7, -r * 0.3, r * 0.15, r * 0.22, 0.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#FF6B6B';
    ctx.beginPath();
    ctx.ellipse(-r * 0.68, -r * 0.28, r * 0.07, r * 0.12, -0.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(r * 0.68, -r * 0.28, r * 0.07, r * 0.12, 0.3, 0, Math.PI * 2);
    ctx.fill();
    // 金箍（紧箍咒）
    ctx.strokeStyle = '#FFD700';
    ctx.lineWidth = r * 0.08;
    ctx.beginPath();
    ctx.ellipse(0, -r * 0.55, r * 0.7, r * 0.18, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = '#DAA520';
    ctx.lineWidth = r * 0.03;
    ctx.beginPath();
    ctx.ellipse(0, -r * 0.55, r * 0.7, r * 0.18, 0, 0, Math.PI * 2);
    ctx.stroke();
    // 金箍两侧月牙
    ctx.fillStyle = '#FFD700';
    ctx.beginPath();
    ctx.arc(-r * 0.7, -r * 0.55, r * 0.06, 0, Math.PI * 2);
    ctx.arc(r * 0.7, -r * 0.55, r * 0.06, 0, Math.PI * 2);
    ctx.fill();

  } else if (lv === 7) {
    // 观音菩萨：长耳垂 + 高发髻
    ctx.fillStyle = shadeColor(pig.color, -5);
    ctx.beginPath();
    ctx.ellipse(-r * 0.7, -r * 0.15, r * 0.12, r * 0.3, -0.1, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(r * 0.7, -r * 0.15, r * 0.12, r * 0.3, 0.1, 0, Math.PI * 2);
    ctx.fill();
    // 发髻
    ctx.fillStyle = shadeColor(pig.darkColor, -10);
    ctx.beginPath();
    ctx.ellipse(0, -r * 0.85, r * 0.3, r * 0.25, 0, 0, Math.PI * 2);
    ctx.fill();
    // 白纱
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.beginPath();
    ctx.ellipse(0, -r * 0.7, r * 0.35, r * 0.12, 0, 0, Math.PI * 2);
    ctx.fill();

  } else if (lv === 8) {
    // 如来佛祖：螺发 + 长耳垂
    ctx.fillStyle = shadeColor(pig.darkColor, -5);
    ctx.beginPath();
    ctx.ellipse(-r * 0.72, -r * 0.1, r * 0.12, r * 0.32, -0.1, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(r * 0.72, -r * 0.1, r * 0.12, r * 0.32, 0.1, 0, Math.PI * 2);
    ctx.fill();
    // 螺旋发（头顶）
    ctx.fillStyle = shadeColor(pig.darkColor, -10);
    for (var ci = 0; ci < 7; ci++) {
      var ca = -r * 0.5 + ci * r * 0.17;
      var cy = -r * 0.75 - Math.abs(ci - 3) * r * 0.05;
      ctx.beginPath();
      ctx.arc(ca, cy, r * 0.06, 0, Math.PI * 2);
      ctx.fill();
    }
    // 肉髻（头顶凸起）
    ctx.beginPath();
    ctx.arc(0, -r * 0.88, r * 0.1, 0, Math.PI * 2);
    ctx.fill();

  } else if (lv === 9) {
    // 玉皇大帝：冕旒（帝王冠冕）
    // 冠板
    ctx.fillStyle = shadeColor(pig.darkColor, -5);
    ctx.beginPath();
    ctx.ellipse(0, -r * 0.7, r * 0.55, r * 0.12, 0, 0, Math.PI * 2);
    ctx.fill();
    // 冠体
    ctx.fillStyle = shadeColor(pig.color, -10);
    ctx.beginPath();
    ctx.moveTo(-r * 0.45, -r * 0.7);
    ctx.lineTo(-r * 0.4, -r * 0.45);
    ctx.lineTo(r * 0.4, -r * 0.45);
    ctx.lineTo(r * 0.45, -r * 0.7);
    ctx.closePath();
    ctx.fill();
    // 前后垂珠
    ctx.fillStyle = '#FFD700';
    for (var ci2 = 0; ci2 < 7; ci2++) {
      var bx = -r * 0.35 + ci2 * r * 0.12;
      ctx.beginPath();
      ctx.arc(bx, -r * 0.35, r * 0.04, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(bx, -r * 0.25, r * 0.035, 0, Math.PI * 2);
      ctx.fill();
    }
    // 长耳垂
    ctx.fillStyle = shadeColor(pig.color, -5);
    ctx.beginPath();
    ctx.ellipse(-r * 0.7, -r * 0.1, r * 0.1, r * 0.28, -0.1, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(r * 0.7, -r * 0.1, r * 0.1, r * 0.28, 0.1, 0, Math.PI * 2);
    ctx.fill();

  } else if (lv === 10) {
    // 盘古：创世之角 + 蓬发
    // 蓬发
    ctx.fillStyle = shadeColor(pig.darkColor, -20);
    for (var hi = 0; hi < 5; hi++) {
      var hx = -r * 0.4 + hi * r * 0.2;
      var hh = -r * 1.0 - Math.sin(hi * 2.3) * r * 0.08;
      ctx.beginPath();
      ctx.moveTo(hx - r * 0.08, -r * 0.6);
      ctx.lineTo(hx, hh);
      ctx.lineTo(hx + r * 0.08, -r * 0.6);
      ctx.closePath();
      ctx.fill();
    }
    // 创世角
    ctx.fillStyle = shadeColor(pig.color, 15);
    ctx.beginPath();
    ctx.moveTo(-r * 0.35, -r * 0.65);
    ctx.quadraticCurveTo(-r * 0.55, -r * 1.1, -r * 0.2, -r * 1.0);
    ctx.quadraticCurveTo(-r * 0.15, -r * 0.8, -r * 0.3, -r * 0.65);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(r * 0.35, -r * 0.65);
    ctx.quadraticCurveTo(r * 0.55, -r * 1.1, r * 0.2, -r * 1.0);
    ctx.quadraticCurveTo(r * 0.15, -r * 0.8, r * 0.3, -r * 0.65);
    ctx.closePath();
    ctx.fill();
    // 角的高光
    ctx.fillStyle = 'rgba(255,255,255,0.3)';
    ctx.beginPath();
    ctx.moveTo(-r * 0.3, -r * 0.7);
    ctx.lineTo(-r * 0.4, -r * 0.95);
    ctx.lineTo(-r * 0.25, -r * 0.75);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(r * 0.3, -r * 0.7);
    ctx.lineTo(r * 0.4, -r * 0.95);
    ctx.lineTo(r * 0.25, -r * 0.75);
    ctx.closePath();
    ctx.fill();
  }
};

// ── 脸部 ──────────────────────────────────────────

Renderer.prototype._drawFace = function (r, pig) {
  var expr = pig.expression;
  this._drawSnout(r, pig);
  this._drawEyes(r, expr, pig);
  this._drawMouth(r, expr, pig);
};

// ── 鼻子 / 面部标记（10 种角色各不同） ─────────────

Renderer.prototype._drawSnout = function (r, pig) {
  var ctx = this.ctx;
  var lv = pig.level;

  if (lv === 1) {
    // 小妖：尖牙
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.moveTo(-r * 0.1, r * 0.15);
    ctx.lineTo(-r * 0.05, r * 0.28);
    ctx.lineTo(0, r * 0.15);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(r * 0.1, r * 0.15);
    ctx.lineTo(r * 0.05, r * 0.28);
    ctx.lineTo(0, r * 0.15);
    ctx.closePath();
    ctx.fill();

  } else if (lv === 2) {
    // 白骨精：骷髅鼻孔
    ctx.fillStyle = '#2a2a2a';
    ctx.beginPath();
    ctx.ellipse(-r * 0.06, r * 0.15, r * 0.04, r * 0.06, 0, 0, Math.PI * 2);
    ctx.ellipse(r * 0.06, r * 0.15, r * 0.04, r * 0.06, 0, 0, Math.PI * 2);
    ctx.fill();

  } else if (lv === 3) {
    // 蜘蛛精：毒牙
    ctx.fillStyle = '#FFD700';
    ctx.beginPath();
    ctx.moveTo(-r * 0.1, r * 0.15);
    ctx.lineTo(-r * 0.07, r * 0.28);
    ctx.lineTo(-r * 0.04, r * 0.15);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(r * 0.1, r * 0.15);
    ctx.lineTo(r * 0.07, r * 0.28);
    ctx.lineTo(r * 0.04, r * 0.15);
    ctx.closePath();
    ctx.fill();
    // 红色口鼻区
    ctx.fillStyle = 'rgba(139,0,0,0.3)';
    ctx.beginPath();
    ctx.ellipse(0, r * 0.18, r * 0.18, r * 0.12, 0, 0, Math.PI * 2);
    ctx.fill();

  } else if (lv === 4) {
    // 沙悟净：络腮胡
    ctx.fillStyle = shadeColor(pig.darkColor, -20);
    ctx.beginPath();
    ctx.ellipse(0, r * 0.25, r * 0.35, r * 0.22, 0, 0, Math.PI * 2);
    ctx.fill();
    // 鼻子
    ctx.fillStyle = shadeColor(pig.color, -10);
    ctx.beginPath();
    ctx.ellipse(0, r * 0.1, r * 0.1, r * 0.07, 0, 0, Math.PI * 2);
    ctx.fill();

  } else if (lv === 5) {
    // 猪八戒：猪鼻子
    ctx.fillStyle = shadeColor(pig.color, -15);
    ctx.beginPath();
    ctx.ellipse(0, r * 0.18, r * 0.2, r * 0.14, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#2a2a2a';
    ctx.beginPath();
    ctx.ellipse(-r * 0.06, r * 0.18, r * 0.04, r * 0.05, 0, 0, Math.PI * 2);
    ctx.ellipse(r * 0.06, r * 0.18, r * 0.04, r * 0.05, 0, 0, Math.PI * 2);
    ctx.fill();

  } else if (lv === 6) {
    // 孙悟空：猴脸心形
    ctx.fillStyle = shadeColor(pig.color, 15);
    ctx.beginPath();
    ctx.ellipse(0, r * 0.15, r * 0.25, r * 0.2, 0, 0, Math.PI * 2);
    ctx.fill();
    // 鼻孔
    ctx.fillStyle = shadeColor(pig.darkColor, -10);
    ctx.beginPath();
    ctx.ellipse(-r * 0.05, r * 0.15, r * 0.025, r * 0.035, 0, 0, Math.PI * 2);
    ctx.ellipse(r * 0.05, r * 0.15, r * 0.025, r * 0.035, 0, 0, Math.PI * 2);
    ctx.fill();

  } else if (lv === 7) {
    // 观音菩萨：白毫（额头朱砂痣）
    ctx.fillStyle = '#FF4444';
    ctx.beginPath();
    ctx.arc(0, -r * 0.3, r * 0.04, 0, Math.PI * 2);
    ctx.fill();
    // 小鼻
    ctx.fillStyle = shadeColor(pig.color, -8);
    ctx.beginPath();
    ctx.ellipse(0, r * 0.12, r * 0.06, r * 0.04, 0, 0, Math.PI * 2);
    ctx.fill();

  } else if (lv === 8) {
    // 如来佛祖：白毫 + 鼻
    ctx.fillStyle = '#FFD700';
    ctx.beginPath();
    ctx.arc(0, -r * 0.3, r * 0.05, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = shadeColor(pig.color, -8);
    ctx.beginPath();
    ctx.ellipse(0, r * 0.12, r * 0.08, r * 0.05, 0, 0, Math.PI * 2);
    ctx.fill();

  } else if (lv === 9) {
    // 玉皇大帝：帝王胡须
    ctx.fillStyle = shadeColor(pig.darkColor, -15);
    ctx.beginPath();
    ctx.moveTo(-r * 0.12, r * 0.12);
    ctx.quadraticCurveTo(-r * 0.08, r * 0.4, -r * 0.15, r * 0.5);
    ctx.quadraticCurveTo(0, r * 0.42, 0, r * 0.3);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(r * 0.12, r * 0.12);
    ctx.quadraticCurveTo(r * 0.08, r * 0.4, r * 0.15, r * 0.5);
    ctx.quadraticCurveTo(0, r * 0.42, 0, r * 0.3);
    ctx.closePath();
    ctx.fill();
    // 鼻
    ctx.fillStyle = shadeColor(pig.color, -8);
    ctx.beginPath();
    ctx.ellipse(0, r * 0.1, r * 0.07, r * 0.05, 0, 0, Math.PI * 2);
    ctx.fill();
    // 额头帝徽
    ctx.fillStyle = '#FFD700';
    ctx.beginPath();
    ctx.arc(0, -r * 0.3, r * 0.06, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#FF4444';
    ctx.beginPath();
    ctx.arc(0, -r * 0.3, r * 0.03, 0, Math.PI * 2);
    ctx.fill();

  } else if (lv === 10) {
    // 盘古：天眼 + 原始鼻
    // 天眼
    ctx.fillStyle = 'rgba(255,255,100,0.8)';
    ctx.beginPath();
    ctx.ellipse(0, -r * 0.35, r * 0.08, r * 0.04, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#FF4400';
    ctx.beginPath();
    ctx.arc(0, -r * 0.35, r * 0.025, 0, Math.PI * 2);
    ctx.fill();
    // 鼻
    ctx.fillStyle = shadeColor(pig.color, -10);
    ctx.beginPath();
    ctx.ellipse(0, r * 0.12, r * 0.08, r * 0.06, 0, 0, Math.PI * 2);
    ctx.fill();
    // 原始纹路
    ctx.strokeStyle = 'rgba(255,255,255,0.3)';
    ctx.lineWidth = r * 0.015;
    ctx.beginPath();
    ctx.moveTo(-r * 0.15, r * 0.0);
    ctx.lineTo(-r * 0.1, r * 0.2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(r * 0.15, r * 0.0);
    ctx.lineTo(r * 0.1, r * 0.2);
    ctx.stroke();
  }
};

// ── 眼睛（5种表情，通用） ────────────────────────

Renderer.prototype._drawEyes = function (r, expr, pig) {
  var ctx = this.ctx;
  var eyeOX = r * 0.3;
  var eyeY = -r * 0.1;

  if (expr === 'scared') {
    var scare = pig.getScareLevel();
    var bigR = r * (0.13 + scare * 0.05);
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(-eyeOX, eyeY, bigR, 0, Math.PI * 2);
    ctx.arc(eyeOX, eyeY, bigR, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#222';
    var pupilR = bigR * (0.4 - scare * 0.15);
    ctx.beginPath();
    ctx.arc(-eyeOX, eyeY + bigR * 0.1, pupilR, 0, Math.PI * 2);
    ctx.arc(eyeOX, eyeY + bigR * 0.1, pupilR, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#553333';
    ctx.lineWidth = r * 0.04;
    ctx.beginPath();
    ctx.moveTo(-eyeOX - r * 0.12, eyeY - bigR - r * 0.08);
    ctx.lineTo(-eyeOX + r * 0.08, eyeY - bigR - r * 0.14);
    ctx.moveTo(eyeOX - r * 0.08, eyeY - bigR - r * 0.14);
    ctx.lineTo(eyeOX + r * 0.12, eyeY - bigR - r * 0.08);
    ctx.stroke();

  } else if (expr === 'dizzy') {
    ctx.strokeStyle = '#333';
    ctx.lineWidth = r * 0.05;
    var dr = r * 0.1;
    ctx.beginPath();
    ctx.moveTo(-eyeOX - dr, eyeY - dr);
    ctx.lineTo(-eyeOX + dr, eyeY + dr);
    ctx.moveTo(-eyeOX + dr, eyeY - dr);
    ctx.lineTo(-eyeOX - dr, eyeY + dr);
    ctx.moveTo(eyeOX - dr, eyeY - dr);
    ctx.lineTo(eyeOX + dr, eyeY + dr);
    ctx.moveTo(eyeOX + dr, eyeY - dr);
    ctx.lineTo(eyeOX - dr, eyeY + dr);
    ctx.stroke();

  } else if (expr === 'happy') {
    ctx.strokeStyle = '#333';
    ctx.lineWidth = r * 0.05;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(-eyeOX, eyeY + r * 0.02, r * 0.1, Math.PI * 1.15, Math.PI * 1.85, false);
    ctx.arc(eyeOX, eyeY + r * 0.02, r * 0.1, Math.PI * 1.15, Math.PI * 1.85, false);
    ctx.stroke();
    ctx.lineCap = 'butt';
    ctx.fillStyle = 'rgba(255,120,140,0.4)';
    ctx.beginPath();
    ctx.arc(-r * 0.5, r * 0.05, r * 0.1, 0, Math.PI * 2);
    ctx.arc(r * 0.5, r * 0.05, r * 0.1, 0, Math.PI * 2);
    ctx.fill();

  } else if (expr === 'confident') {
    var eyeR2 = r * 0.12;
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.ellipse(-eyeOX, eyeY, eyeR2, eyeR2 * 0.55, 0, 0, Math.PI * 2);
    ctx.ellipse(eyeOX, eyeY, eyeR2, eyeR2 * 0.55, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#222';
    ctx.beginPath();
    ctx.ellipse(-eyeOX, eyeY + eyeR2 * 0.1, eyeR2 * 0.5, eyeR2 * 0.35, 0, 0, Math.PI * 2);
    ctx.ellipse(eyeOX, eyeY + eyeR2 * 0.1, eyeR2 * 0.5, eyeR2 * 0.35, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#553333';
    ctx.lineWidth = r * 0.035;
    ctx.beginPath();
    ctx.moveTo(-eyeOX - eyeR2, eyeY - eyeR2 * 0.55);
    ctx.lineTo(-eyeOX + eyeR2, eyeY - eyeR2 * 0.55);
    ctx.moveTo(eyeOX - eyeR2, eyeY - eyeR2 * 0.55);
    ctx.lineTo(eyeOX + eyeR2, eyeY - eyeR2 * 0.55);
    ctx.stroke();

  } else {
    var eyeR3 = r * 0.12;
    ctx.fillStyle = '#333';
    ctx.beginPath();
    ctx.arc(-eyeOX, eyeY, eyeR3, 0, Math.PI * 2);
    ctx.arc(eyeOX, eyeY, eyeR3, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(-eyeOX + eyeR3 * 0.3, eyeY - eyeR3 * 0.3, eyeR3 * 0.4, 0, Math.PI * 2);
    ctx.arc(eyeOX + eyeR3 * 0.3, eyeY - eyeR3 * 0.3, eyeR3 * 0.4, 0, Math.PI * 2);
    ctx.fill();
  }
};

// ── 嘴巴（5种表情，通用） ────────────────────────

Renderer.prototype._drawMouth = function (r, expr, pig) {
  var ctx = this.ctx;
  var my = r * 0.45;

  ctx.strokeStyle = '#7a4030';
  ctx.lineWidth = r * 0.04;
  ctx.lineCap = 'round';

  if (expr === 'scared') {
    ctx.fillStyle = '#6a3020';
    ctx.beginPath();
    ctx.ellipse(0, my + r * 0.02, r * 0.08, r * 0.1, 0, 0, Math.PI * 2);
    ctx.fill();

  } else if (expr === 'dizzy') {
    ctx.beginPath();
    ctx.moveTo(-r * 0.12, my);
    ctx.quadraticCurveTo(-r * 0.06, my - r * 0.05, 0, my);
    ctx.quadraticCurveTo(r * 0.06, my + r * 0.05, r * 0.12, my);
    ctx.stroke();

  } else if (expr === 'happy') {
    ctx.beginPath();
    ctx.arc(0, my - r * 0.05, r * 0.15, 0.15 * Math.PI, 0.85 * Math.PI, false);
    ctx.stroke();
    ctx.fillStyle = '#FF9999';
    ctx.beginPath();
    ctx.ellipse(0, my + r * 0.02, r * 0.06, r * 0.04, 0, 0, Math.PI * 2);
    ctx.fill();

  } else if (expr === 'confident') {
    ctx.beginPath();
    ctx.moveTo(-r * 0.1, my);
    ctx.quadraticCurveTo(0, my + r * 0.06, r * 0.12, my - r * 0.03);
    ctx.stroke();

  } else {
    ctx.beginPath();
    ctx.arc(0, my - r * 0.08, r * 0.1, 0.2 * Math.PI, 0.8 * Math.PI, false);
    ctx.stroke();
  }
  ctx.lineCap = 'butt';
};

// ── 汗珠 ──────────────────────────────────────────

Renderer.prototype._drawSweat = function (r, scareLevel) {
  var ctx = this.ctx;
  var dropR = r * 0.07 * (0.7 + scareLevel * 0.5);
  var offset = r * 0.55;
  var bounce = Math.sin(this._time * 8) * r * 0.04;

  ctx.fillStyle = 'rgba(100, 200, 255, 0.8)';
  ctx.beginPath();
  ctx.ellipse(offset, -r * 0.4 + bounce, dropR * 0.7, dropR, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.6)';
  ctx.beginPath();
  ctx.arc(offset - dropR * 0.2, -r * 0.4 + bounce - dropR * 0.2, dropR * 0.25, 0, Math.PI * 2);
  ctx.fill();

  if (scareLevel > 0.4) {
    var bounce2 = Math.sin(this._time * 8 + 1.5) * r * 0.04;
    ctx.fillStyle = 'rgba(100, 200, 255, 0.6)';
    ctx.beginPath();
    ctx.ellipse(-offset * 0.9, -r * 0.45 + bounce2, dropR * 0.5, dropR * 0.8, 0, 0, Math.PI * 2);
    ctx.fill();
  }
};

// ── 眩晕星星 ──────────────────────────────────────

Renderer.prototype._drawDizzyStars = function (r) {
  var angle = this._time * 4;
  for (var i = 0; i < 3; i++) {
    var a = angle + i * (Math.PI * 2 / 3);
    var sx = Math.cos(a) * r * 0.7;
    var sy = -r * 0.65 + Math.sin(a) * r * 0.12;
    this._drawStar(sx, sy, r * 0.06, '#FFD700');
  }
};

Renderer.prototype._drawStar = function (x, y, size, color) {
  var ctx = this.ctx;
  ctx.fillStyle = color;
  ctx.beginPath();
  for (var i = 0; i < 5; i++) {
    var a = (i * 2 * Math.PI / 5) - Math.PI / 2;
    var px = x + Math.cos(a) * size;
    var py = y + Math.sin(a) * size;
    if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    var ia = a + Math.PI / 5;
    ctx.lineTo(x + Math.cos(ia) * size * 0.4, y + Math.sin(ia) * size * 0.4);
  }
  ctx.closePath();
  ctx.fill();
};

// ════════════════════════════════════════════════════
//  级别装饰（10 种角色各自独特装饰）
// ════════════════════════════════════════════════════

Renderer.prototype._drawAccessory = function (r, pig) {
  var ctx = this.ctx;
  var lv = pig.level;

  if (lv === 1) {
    // 小妖：三叉戟小武器
    ctx.strokeStyle = '#8B4513';
    ctx.lineWidth = r * 0.04;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(r * 0.7, r * 0.2);
    ctx.lineTo(r * 0.95, r * 0.6);
    ctx.stroke();
    ctx.fillStyle = '#9966CC';
    ctx.beginPath();
    ctx.moveTo(r * 0.92, r * 0.5);
    ctx.lineTo(r * 0.98, r * 0.4);
    ctx.lineTo(r * 0.88, r * 0.42);
    ctx.closePath();
    ctx.fill();
    ctx.lineCap = 'butt';

  } else if (lv === 2) {
    // 白骨精：骷髅装饰
    ctx.fillStyle = shadeColor(pig.color, -10);
    var skx = r * 0.65, sky = r * 0.3;
    ctx.beginPath();
    ctx.arc(skx, sky, r * 0.1, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#2a2a2a';
    ctx.beginPath();
    ctx.arc(skx - r * 0.04, sky - r * 0.02, r * 0.02, 0, Math.PI * 2);
    ctx.arc(skx + r * 0.04, sky - r * 0.02, r * 0.02, 0, Math.PI * 2);
    ctx.fill();

  } else if (lv === 3) {
    // 蜘蛛精：蛛丝
    ctx.strokeStyle = 'rgba(255,255,255,0.5)';
    ctx.lineWidth = r * 0.015;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-r * 0.6, -r * 0.5);
    ctx.lineTo(-r * 0.9, -r * 0.8);
    ctx.moveTo(r * 0.6, -r * 0.5);
    ctx.lineTo(r * 0.9, -r * 0.8);
    ctx.stroke();
    ctx.lineCap = 'butt';

  } else if (lv === 4) {
    // 沙悟净：佛珠项链
    ctx.strokeStyle = '#8B4513';
    ctx.lineWidth = r * 0.02;
    ctx.beginPath();
    ctx.arc(0, r * 0.5, r * 0.5, 0.15 * Math.PI, 0.85 * Math.PI, false);
    ctx.stroke();
    ctx.fillStyle = '#D2691E';
    for (var bi = 0; bi < 8; bi++) {
      var ba = 0.15 * Math.PI + bi * 0.7 * Math.PI / 7;
      var bx = Math.cos(ba) * r * 0.5;
      var by = r * 0.5 + Math.sin(ba) * r * 0.5;
      ctx.beginPath();
      ctx.arc(bx, by, r * 0.04, 0, Math.PI * 2);
      ctx.fill();
    }

  } else if (lv === 5) {
    // 猪八戒：九齿钉耙标志
    ctx.strokeStyle = '#8B4513';
    ctx.lineWidth = r * 0.04;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(r * 0.6, r * 0.1);
    ctx.lineTo(r * 0.85, r * 0.5);
    ctx.stroke();
    ctx.fillStyle = '#C0C0C0';
    for (var ri = 0; ri < 3; ri++) {
      ctx.beginPath();
      ctx.moveTo(r * 0.82 + ri * r * 0.05, r * 0.45);
      ctx.lineTo(r * 0.82 + ri * r * 0.05, r * 0.58);
      ctx.lineWidth = r * 0.025;
      ctx.stroke();
    }
    ctx.lineCap = 'butt';

  } else if (lv === 6) {
    // 孙悟空：金箍棒
    ctx.save();
    ctx.rotate(0.5);
    ctx.fillStyle = '#DEB887';
    ctx.fillRect(r * 0.3, -r * 0.1, r * 0.8, r * 0.08);
    ctx.fillStyle = '#FFD700';
    ctx.fillRect(r * 0.3, -r * 0.12, r * 0.1, r * 0.12);
    ctx.fillRect(r * 1.0, -r * 0.12, r * 0.1, r * 0.12);
    ctx.restore();
    // 红披风一角
    ctx.fillStyle = 'rgba(220,20,20,0.5)';
    ctx.beginPath();
    ctx.moveTo(-r * 0.5, r * 0.4);
    ctx.quadraticCurveTo(-r * 0.9, r * 0.6, -r * 0.7, r * 0.8);
    ctx.quadraticCurveTo(-r * 0.5, r * 0.6, -r * 0.3, r * 0.5);
    ctx.closePath();
    ctx.fill();

  } else if (lv === 7) {
    // 观音菩萨：莲花座 + 杨柳枝
    ctx.fillStyle = 'rgba(255,200,220,0.6)';
    for (var li = 0; li < 6; li++) {
      var la = li * Math.PI / 3;
      var lx = Math.cos(la) * r * 0.5;
      var ly = r * 0.7 + Math.sin(la) * r * 0.1;
      ctx.beginPath();
      ctx.ellipse(lx, ly, r * 0.12, r * 0.06, la, 0, Math.PI * 2);
      ctx.fill();
    }
    // 杨柳枝
    ctx.strokeStyle = '#6B8E23';
    ctx.lineWidth = r * 0.03;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(r * 0.6, r * 0.0);
    ctx.quadraticCurveTo(r * 0.8, -r * 0.2, r * 0.75, -r * 0.5);
    ctx.stroke();
    ctx.fillStyle = '#6B8E23';
    ctx.beginPath();
    ctx.ellipse(r * 0.75, -r * 0.55, r * 0.04, r * 0.08, 0.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineCap = 'butt';

  } else if (lv === 8) {
    // 如来佛祖：法轮 + 莲花座
    ctx.fillStyle = 'rgba(255,215,0,0.5)';
    for (var fi = 0; fi < 8; fi++) {
      var fa = fi * Math.PI / 4;
      var fx = Math.cos(fa) * r * 0.5;
      var ly2 = r * 0.7 + Math.sin(fa) * r * 0.1;
      ctx.beginPath();
      ctx.ellipse(fx, ly2, r * 0.13, r * 0.07, fa, 0, Math.PI * 2);
      ctx.fill();
    }
    // 法轮
    ctx.strokeStyle = 'rgba(255,215,0,0.6)';
    ctx.lineWidth = r * 0.03;
    ctx.beginPath();
    ctx.arc(0, r * 0.45, r * 0.15, 0, Math.PI * 2);
    ctx.stroke();
    for (var spi = 0; spi < 8; spi++) {
      var sa = spi * Math.PI / 4;
      ctx.beginPath();
      ctx.moveTo(0, r * 0.45);
      ctx.lineTo(Math.cos(sa) * r * 0.15, r * 0.45 + Math.sin(sa) * r * 0.15);
      ctx.stroke();
    }

  } else if (lv === 9) {
    // 玉皇大帝：玉玺 + 龙纹云座
    // 云纹宝座
    ctx.fillStyle = 'rgba(255,215,0,0.4)';
    for (var cli = 0; cli < 8; cli++) {
      var cla = cli * Math.PI / 4;
      var clx = Math.cos(cla) * r * 0.5;
      var cly = r * 0.7 + Math.sin(cla) * r * 0.1;
      ctx.beginPath();
      ctx.ellipse(clx, cly, r * 0.14, r * 0.07, cla, 0, Math.PI * 2);
      ctx.fill();
    }
    // 玉玺
    ctx.fillStyle = '#4169E1';
    ctx.fillRect(-r * 0.12, r * 0.0, r * 0.24, r * 0.2);
    ctx.fillStyle = '#FFD700';
    ctx.fillRect(-r * 0.08, r * 0.0, r * 0.16, r * 0.06);
    // 龙形手柄
    ctx.strokeStyle = 'rgba(255,215,0,0.5)';
    ctx.lineWidth = r * 0.03;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(0, r * 0.0);
    ctx.quadraticCurveTo(r * 0.1, -r * 0.15, 0, -r * 0.2);
    ctx.quadraticCurveTo(-r * 0.1, -r * 0.15, 0, r * 0.0);
    ctx.stroke();
    ctx.lineCap = 'butt';

  } else if (lv === 10) {
    // 盘古：盘古斧 + 混沌球
    // 混沌宝座
    ctx.fillStyle = 'rgba(147,112,219,0.4)';
    for (var pli = 0; pli < 8; pli++) {
      var pla = pli * Math.PI / 4;
      var plx = Math.cos(pla) * r * 0.5;
      var ply = r * 0.7 + Math.sin(pla) * r * 0.1;
      ctx.beginPath();
      ctx.ellipse(plx, ply, r * 0.15, r * 0.08, pla, 0, Math.PI * 2);
      ctx.fill();
    }
    // 盘古斧
    ctx.save();
    ctx.rotate(0.3);
    // 斧柄
    ctx.fillStyle = '#8B4513';
    ctx.fillRect(r * 0.3, -r * 0.05, r * 0.7, r * 0.08);
    // 斧头
    ctx.fillStyle = '#C0C0C0';
    ctx.beginPath();
    ctx.moveTo(r * 0.85, -r * 0.05);
    ctx.lineTo(r * 0.85 + r * 0.25, -r * 0.2);
    ctx.lineTo(r * 0.85 + r * 0.3, r * 0.15);
    ctx.lineTo(r * 0.85, r * 0.15);
    ctx.closePath();
    ctx.fill();
    // 斧刃高光
    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    ctx.beginPath();
    ctx.moveTo(r * 1.05, -r * 0.15);
    ctx.lineTo(r * 1.1, r * 0.1);
    ctx.lineTo(r * 1.05, r * 0.1);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    // 混沌球
    var cg = ctx.createRadialGradient(-r * 0.5, r * 0.2, 0, -r * 0.5, r * 0.2, r * 0.15);
    cg.addColorStop(0, 'rgba(200,180,255,0.6)');
    cg.addColorStop(1, 'rgba(100,80,180,0.2)');
    ctx.fillStyle = cg;
    ctx.beginPath();
    ctx.arc(-r * 0.5, r * 0.2, r * 0.15, 0, Math.PI * 2);
    ctx.fill();
  }

  // 级别数字
  ctx.fillStyle = 'rgba(255,255,255,0.35)';
  ctx.font = 'bold ' + Math.round(r * 0.18) + 'px Arial';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(pig.level, 0, r * 0.72);
};

// ════════════════════════════════════════════════════
//  背景装饰辅助方法
// ════════════════════════════════════════════════════

// ── 观音菩萨莲花瓣（画在变换之前） ───────────────

Renderer.prototype._drawLotusPetals = function (x, y, r, tilt) {
  var ctx = this.ctx;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(tilt * 0.2);

  var pulse = 1 + Math.sin(this._time * 2) * 0.05;

  for (var i = 0; i < 8; i++) {
    var a = i * Math.PI / 4 + this._time * 0.3;
    var px = Math.cos(a) * r * 0.85 * pulse;
    var py = Math.sin(a) * r * 0.85 * pulse;
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(a + Math.PI / 2);
    var g = ctx.createLinearGradient(0, -r * 0.2, 0, r * 0.2);
    g.addColorStop(0, 'rgba(255,200,220,0.7)');
    g.addColorStop(1, 'rgba(255,180,200,0.2)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(0, 0, r * 0.14, r * 0.06, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // 中心光晕
  ctx.fillStyle = 'rgba(255,220,240,0.15)';
  ctx.beginPath();
  ctx.arc(0, 0, r * 1.05 * pulse, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
};

// ── 如来佛祖金色光环（画在变换之前） ─────────────

Renderer.prototype._drawBuddhaAura = function (x, y, r, tilt) {
  var ctx = this.ctx;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(tilt * 0.1);

  var pulse = 1 + Math.sin(this._time * 1.5) * 0.04;

  // 外层金色光环
  var g = ctx.createRadialGradient(0, 0, r * 0.9, 0, 0, r * 1.3 * pulse);
  g.addColorStop(0, 'rgba(255,215,0,0)');
  g.addColorStop(0.5, 'rgba(255,215,0,0.15)');
  g.addColorStop(1, 'rgba(255,215,0,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(0, 0, r * 1.3 * pulse, 0, Math.PI * 2);
  ctx.fill();

  // 光芒射线
  for (var i = 0; i < 12; i++) {
    var a = i * Math.PI / 6 + this._time * 0.2;
    ctx.strokeStyle = 'rgba(255,215,0,0.2)';
    ctx.lineWidth = r * 0.03;
    ctx.beginPath();
    ctx.moveTo(Math.cos(a) * r * 0.95, Math.sin(a) * r * 0.95);
    ctx.lineTo(Math.cos(a) * r * 1.2 * pulse, Math.sin(a) * r * 1.2 * pulse);
    ctx.stroke();
  }

  ctx.restore();
};

// ── 玉皇大帝帝王光环（画在变换之前） ─────────────

Renderer.prototype._drawImperialAura = function (x, y, r, tilt) {
  var ctx = this.ctx;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(tilt * 0.1);

  var pulse = 1 + Math.sin(this._time * 1.2) * 0.05;

  // 金色帝王光环
  var g = ctx.createRadialGradient(0, 0, r * 0.9, 0, 0, r * 1.4 * pulse);
  g.addColorStop(0, 'rgba(255,215,0,0)');
  g.addColorStop(0.4, 'rgba(255,215,0,0.18)');
  g.addColorStop(1, 'rgba(255,180,0,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(0, 0, r * 1.4 * pulse, 0, Math.PI * 2);
  ctx.fill();

  // 浮动祥云
  for (var i = 0; i < 6; i++) {
    var a = i * Math.PI / 3 + this._time * 0.15;
    var cx = Math.cos(a) * r * 1.05 * pulse;
    var cy = Math.sin(a) * r * 1.05 * pulse;
    ctx.fillStyle = 'rgba(255,230,180,' + (0.25 + Math.sin(this._time * 2 + i) * 0.1) + ')';
    ctx.beginPath();
    ctx.ellipse(cx, cy, r * 0.1, r * 0.05, a, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
};

// ── 盘古混沌漩涡（画在变换之前） ─────────────────

Renderer.prototype._drawChaosSwirl = function (x, y, r, tilt) {
  var ctx = this.ctx;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(tilt * 0.15);

  var pulse = 1 + Math.sin(this._time * 0.8) * 0.06;

  // 混沌能量场
  var g = ctx.createRadialGradient(0, 0, r * 0.85, 0, 0, r * 1.5 * pulse);
  g.addColorStop(0, 'rgba(147,112,219,0)');
  g.addColorStop(0.3, 'rgba(147,112,219,0.15)');
  g.addColorStop(0.7, 'rgba(100,80,180,0.1)');
  g.addColorStop(1, 'rgba(50,30,100,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(0, 0, r * 1.5 * pulse, 0, Math.PI * 2);
  ctx.fill();

  // 旋转星辰
  for (var i = 0; i < 10; i++) {
    var a = i * Math.PI / 5 + this._time * 0.3;
    var sr = r * (1.0 + Math.sin(this._time * 1.5 + i) * 0.15) * pulse;
    var sx = Math.cos(a) * sr;
    var sy = Math.sin(a) * sr;
    ctx.fillStyle = 'rgba(255,255,200,' + (0.3 + Math.sin(this._time * 3 + i) * 0.2) + ')';
    ctx.beginPath();
    ctx.arc(sx, sy, r * 0.025, 0, Math.PI * 2);
    ctx.fill();
  }

  // 混沌漩涡线
  ctx.strokeStyle = 'rgba(200,180,255,0.15)';
  ctx.lineWidth = r * 0.02;
  for (var ri2 = 0; ri2 < 2; ri2++) {
    ctx.beginPath();
    for (var ta = 0; ta < Math.PI * 2; ta += 0.1) {
      var tr = r * (1.1 + ri2 * 0.15) * pulse * (0.8 + Math.sin(ta * 3 + this._time) * 0.1);
      var tx = Math.cos(ta + this._time * 0.2 + ri2) * tr;
      var ty = Math.sin(ta + this._time * 0.2 + ri2) * tr;
      if (ta === 0) ctx.moveTo(tx, ty); else ctx.lineTo(tx, ty);
    }
    ctx.closePath();
    ctx.stroke();
  }

  ctx.restore();
};

// ── roundRect 路径辅助 ────────────────────────────

Renderer.prototype._roundRectPath = function (x, y, w, h, r) {
  var ctx = this.ctx;
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
};

Renderer.prototype._roundRect = function (x, y, w, h, r) {
  var ctx = this.ctx;
  ctx.beginPath();
  this._roundRectPath(x, y, w, h, r);
};

// ════════════════════════════════════════════════════
//  UI
// ════════════════════════════════════════════════════

Renderer.prototype.drawUI = function (score, bestScore, nextLevel) {
  var ctx = this.ctx;
  var pad = 12 * this.scale;

  ctx.fillStyle = CFG.COLORS.SCORE_BG;
  var panelW = 120 * this.scale;
  var panelH = 48 * this.scale;
  this._roundRect(pad, pad, panelW, panelH, 8 * this.scale);
  ctx.fill();

  ctx.fillStyle = CFG.COLORS.TEXT_DIM;
  ctx.font = Math.round(11 * this.scale) + 'px Arial';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText('分数', pad + 10 * this.scale, pad + 6 * this.scale);

  ctx.fillStyle = CFG.COLORS.TEXT;
  ctx.font = 'bold ' + Math.round(20 * this.scale) + 'px Arial';
  ctx.fillText(score.toString(), pad + 10 * this.scale, pad + 20 * this.scale);

  if (bestScore > 0) {
    ctx.fillStyle = CFG.COLORS.TEXT_DIM;
    ctx.font = Math.round(10 * this.scale) + 'px Arial';
    ctx.textAlign = 'right';
    ctx.fillText('最高: ' + bestScore, pad + panelW - 8 * this.scale, pad + 6 * this.scale);
  }

  if (nextLevel > 0) {
    var previewR = 18 * this.scale;
    var pvX = this.width - pad - previewR;
    var pvY = pad + previewR + 4 * this.scale;

    ctx.fillStyle = CFG.COLORS.TEXT_DIM;
    ctx.font = Math.round(10 * this.scale) + 'px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText('下一个', pvX, pad);

    var conf = CFG.PIG_LEVELS[nextLevel - 1];
    var grad = ctx.createRadialGradient(
      pvX - previewR * 0.3, pvY - previewR * 0.3, 0,
      pvX, pvY, previewR
    );
    grad.addColorStop(0, shadeColor(conf.color, 25));
    grad.addColorStop(1, conf.color);
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(pvX, pvY, previewR, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#fff';
    ctx.font = 'bold ' + Math.round(10 * this.scale) + 'px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(conf.name, pvX, pvY);
  }
};

Renderer.prototype.drawStartScreen = function () {
  var ctx = this.ctx;
  ctx.fillStyle = 'rgba(0,0,0,0.6)';
  ctx.fillRect(0, 0, this.width, this.height);

  ctx.fillStyle = '#FFB6C1';
  ctx.font = 'bold ' + Math.round(36 * this.scale) + 'px Arial';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('西游合成', this.width / 2, this.height * 0.30);

  ctx.fillStyle = '#FFD93D';
  ctx.font = Math.round(16 * this.scale) + 'px Arial';
  ctx.fillText('小妖 → 白骨精 → 蜘蛛精 → 沙悟净 → ...', this.width / 2, this.height * 0.37);

  ctx.fillStyle = '#fff';
  ctx.font = Math.round(14 * this.scale) + 'px Arial';
  var tips = [
    '滑动手指选择下落位置',
    '松手让角色落下',
    '两个相同角色碰撞合成更高级别',
    '角色超过顶部栅栏则游戏结束'
  ];
  for (var i = 0; i < tips.length; i++) {
    ctx.fillText(tips[i], this.width / 2, this.height * 0.45 + i * 28 * this.scale);
  }

  var btnW = 180 * this.scale;
  var btnH = 50 * this.scale;
  var btnX = (this.width - btnW) / 2;
  var btnY = this.height * 0.68;
  ctx.fillStyle = '#FF6B8A';
  this._roundRect(btnX, btnY, btnW, btnH, 25 * this.scale);
  ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.font = 'bold ' + Math.round(20 * this.scale) + 'px Arial';
  ctx.fillText('开始游戏', this.width / 2, btnY + btnH / 2);
};

Renderer.prototype.drawGameOver = function (score, bestScore, isNewBest) {
  var ctx = this.ctx;
  ctx.fillStyle = 'rgba(0,0,0,0.7)';
  ctx.fillRect(0, 0, this.width, this.height);

  ctx.fillStyle = '#FF6B8A';
  ctx.font = 'bold ' + Math.round(32 * this.scale) + 'px Arial';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('游戏结束', this.width / 2, this.height * 0.3);

  ctx.fillStyle = CFG.COLORS.TEXT_DIM;
  ctx.font = Math.round(14 * this.scale) + 'px Arial';
  ctx.fillText('本局得分', this.width / 2, this.height * 0.4);

  ctx.fillStyle = '#FFD700';
  ctx.font = 'bold ' + Math.round(48 * this.scale) + 'px Arial';
  ctx.fillText(score.toString(), this.width / 2, this.height * 0.46);

  ctx.fillStyle = CFG.COLORS.TEXT_DIM;
  ctx.font = Math.round(14 * this.scale) + 'px Arial';
  if (isNewBest) {
    ctx.fillStyle = '#FFD700';
    ctx.fillText('新纪录！', this.width / 2, this.height * 0.54);
  } else {
    ctx.fillText('最高分: ' + bestScore, this.width / 2, this.height * 0.54);
  }

  var btnW = 180 * this.scale;
  var btnH = 50 * this.scale;
  var btnX = (this.width - btnW) / 2;
  var btnY = this.height * 0.64;
  ctx.fillStyle = '#FF6B8A';
  this._roundRect(btnX, btnY, btnW, btnH, 25 * this.scale);
  ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.font = 'bold ' + Math.round(20 * this.scale) + 'px Arial';
  ctx.fillText('再来一局', this.width / 2, btnY + btnH / 2);
};

module.exports = Renderer;
