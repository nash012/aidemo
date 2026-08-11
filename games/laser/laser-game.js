// ============================================================
// 激光镭射象棋 Laser Chess —— 3D版
// 游戏合集模块包装版，3D透视渲染
// 棋盘 10×8，每方13枚棋子，5种官方阵型
// 手指拖动调整视角，游戏居中，安全区域适配
// ============================================================
module.exports = {
  create: function(ctx, W, H, returnToMenu) {
    "use strict";

    /* -------------------- 屏幕别名 -------------------- */
    var SW = W, SH = H;

    /* -------------------- 定时器追踪 -------------------- */
    var _timeouts = [];
    function _setTrackTimeout(fn, delay) {
      var id = setTimeout(function() {
        var idx = _timeouts.indexOf(id);
        if (idx >= 0) _timeouts.splice(idx, 1);
        fn();
      }, delay);
      _timeouts.push(id);
      return id;
    }

    /* -------------------- 安全区域与布局 -------------------- */
    var SAFE_TOP = 52;
    var SAFE_BOT = 36;
    var TOPBAR_H = 48;
    var BTN_H = 44;
    var BTN_GAP = 8;
    var STATUS_H = 22;
    var btnAreaH = BTN_H * 2 + BTN_GAP;
    var boardAreaTop = SAFE_TOP + TOPBAR_H;
    var boardAreaBot = SH - SAFE_BOT - btnAreaH - STATUS_H;

    /* -------------------- 常量与方向 -------------------- */
    var COLS = 10, ROWS = 8;
    var UP = 0, RIGHT = 1, DOWN = 2, LEFT = 3;
    var DX = [0, 1, 0, -1], DY = [-1, 0, 1, 0];
    var DIRS8 = [[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]];
    var LASER = "laser", KING = "king", SHIELD = "shield", MIRROR = "mirror", SWITCH = "switch";
    var PIECE_VAL = { king:10000, shield:3, switch:4, mirror:2, laser:0 };
    var AI_LEVELS = {
      easy:   {attack:0.25, defense:1.2, guard:2.0, reply:0,   candidates:16, variety:8},
      normal: {attack:1.8,  defense:0.7, guard:0.6, reply:0.3, candidates:32, variety:3},
      hard:   {attack:1.2,  defense:1.2, guard:1.5, reply:1.0, candidates:40, variety:0.5}
    };
    var MIRROR_MAP = [ {1:0,2:3}, {3:0,2:1}, {3:2,0:1}, {1:2,0:3} ];
    var SW_SLASH = {1:0,0:1,3:2,2:3};
    var SW_BACK  = {1:2,2:1,3:0,0:3};
    var LASER_DIRS = {0:[LEFT,UP], 1:[RIGHT,DOWN]};

    /* -------------------- 3D 投影系统 -------------------- */
    // pitch=0 水平直视，pitch=π/2 正上方俯视
    // 0.95 ≈ 55°，匹配桌游图片的斜俯视角度
    // yaw=0 正对棋盘，无偏转
    var DEFAULT_YAW = 0;
    var DEFAULT_PITCH = 0.95;
    var cam = {
      yaw: DEFAULT_YAW,
      pitch: DEFAULT_PITCH,
      dist: 15,
      focal: 0,
      cx: SW / 2,
      cy: (boardAreaTop + boardAreaBot) / 2
    };
    cam.focal = Math.min(SW * 0.82, (boardAreaBot - boardAreaTop) * 1.3) * cam.dist / 10;

    var camAnim = null;

    function project3D(x, y, z) {
      z = -z; // 翻转z轴，使row 7（红方）在近端（屏幕底部），row 0（蓝方）在远端（屏幕顶部）
      var cosY = Math.cos(cam.yaw), sinY = Math.sin(cam.yaw);
      var rx = x * cosY - z * sinY;
      var rz = x * sinY + z * cosY;
      var ry = y;
      var cosP = Math.cos(cam.pitch), sinP = Math.sin(cam.pitch);
      // 修正pitch旋转方向：正pitch=俯视，远端在上方，近端在下方
      var ry2 = ry * cosP + rz * sinP;
      var rz2 = -ry * sinP + rz * cosP;
      rz2 += cam.dist;
      if (rz2 < 0.1) rz2 = 0.1;
      var s = cam.focal / rz2;
      return { x: rx * s + cam.cx, y: -ry2 * s + cam.cy, z: rz2, s: s };
    }

    function darkenColor(hex, factor) {
      var r = parseInt(hex.substr(1,2), 16);
      var g = parseInt(hex.substr(3,2), 16);
      var b = parseInt(hex.substr(5,2), 16);
      r = Math.max(0, Math.floor(r * factor));
      g = Math.max(0, Math.floor(g * factor));
      b = Math.max(0, Math.floor(b * factor));
      return "rgb(" + r + "," + g + "," + b + ")";
    }

    function easeInOut(t) {
      return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
    }

    function pieceHeight(type) {
      return { king:1.02, laser:0.65, shield:0.65, mirror:0.70, switch:0.65 }[type] || 0.6;
    }

    /* -------------------- 游戏逻辑（与2D版完全一致） -------------------- */
    function laserHit(p, inDir){
      try {
        var o = p.orientation, t = p.type;
        if(o===undefined||o===null||o<0||o>3) return "block";
        if(inDir===undefined||inDir===null||inDir<0||inDir>3) return "block";
        if(t===KING) return "eliminate";
        if(t===LASER) return "block";
        if(t===SHIELD) return inDir===((o+2)%4) ? "block" : "eliminate";
        if(t===MIRROR){ var r=MIRROR_MAP[o]?MIRROR_MAP[o][inDir]:undefined; return r!==undefined?r:"eliminate"; }
        if(t===SWITCH){ var tbl=(o%2===0)?SW_SLASH:SW_BACK; var r2=tbl[inDir]; return r2!==undefined?r2:"block"; }
        return "block";
      } catch(e) { return "block"; }
    }
    function pieceAt(pieces, r, c){
      for(var i=0;i<pieces.length;i++){ if(pieces[i].alive && pieces[i].row===r && pieces[i].col===c) return pieces[i]; }
      return null;
    }
    function getLaser(pieces, player){
      for(var i=0;i<pieces.length;i++){ if(pieces[i].alive && pieces[i].owner===player && pieces[i].type===LASER) return pieces[i]; }
      return null;
    }
    function simulateLaser(pieces, laser){
      var dir = laser.orientation;
      var r = laser.row + DY[dir], c = laser.col + DX[dir];
      var path = [{r:laser.row, c:laser.col}];
      var eliminated = null;
      var seen = {};
      var steps = 0;
      while(r>=0 && r<ROWS && c>=0 && c<COLS && steps<200){
        steps++;
        var key = r+","+c+","+dir;
        if(seen[key]) break;
        seen[key] = 1;
        var p = pieceAt(pieces, r, c);
        path.push({r:r, c:c});
        if(p){
          var res = laserHit(p, dir);
          if(res==="eliminate"){ eliminated = p; break; }
          if(res==="block") break;
          if(typeof res==="number"){ dir = res; }
          else break;
        }
        r += DY[dir]; c += DX[dir];
      }
      return { path: path, eliminated: eliminated };
    }
    function generateActions(pieces, player, opts){
      opts = opts || {};
      var acts = [];
      for(var i=0;i<pieces.length;i++){
        var p = pieces[i];
        if(p.owner!==player || !p.alive) continue;
        if(p.type===LASER){
          var dirs = LASER_DIRS[player];
          var newDir = p.orientation===dirs[0] ? dirs[1] : dirs[0];
          acts.push({pi:i, kind:"laserRot", dir:newDir});
          continue;
        }
        for(var j=0;j<DIRS8.length;j++){
          var d = DIRS8[j];
          var nr=p.row+d[0], nc=p.col+d[1];
          if(nr<0||nr>=ROWS||nc<0||nc>=COLS) continue;
          if(!isZoneAllowed(nr, nc, p.owner)) continue; // 区域限制
          if(!pieceAt(pieces, nr, nc)) acts.push({pi:i, kind:"move", r:nr, c:nc});
        }
        acts.push({pi:i, kind:"rot", d:1});
        acts.push({pi:i, kind:"rot", d:3});
        if(p.type===SWITCH && !opts.noSwap){
          for(var k=0;k<DIRS8.length;k++){
            var d2 = DIRS8[k];
            var nr2=p.row+d2[0], nc2=p.col+d2[1];
            if(nr2<0||nr2>=ROWS||nc2<0||nc2>=COLS) continue;
            var t = pieceAt(pieces, nr2, nc2);
            if(t && (t.type===SHIELD || t.type===MIRROR)){
              if(isZoneAllowed(nr2, nc2, p.owner) && isZoneAllowed(p.row, p.col, t.owner))
                acts.push({pi:i, kind:"swap", ti:pieces.indexOf(t)});
            }
          }
        }
      }
      return acts;
    }
    function applyAction(pieces, act){
      if(act.kind === "skip") return pieces.map(function(p){ return Object.assign({}, p); });
      var np = pieces.map(function(p){ return Object.assign({}, p); });
      var p = np[act.pi];
      if(act.kind==="rot") p.orientation = (p.orientation + act.d) % 4;
      else if(act.kind==="laserRot") p.orientation = act.dir;
      else if(act.kind==="move"){ p.row = act.r; p.col = act.c; }
      else if(act.kind==="swap"){ var t=np[act.ti]; var tr=t.row,tc=t.col; t.row=p.row;t.col=p.col; p.row=tr;p.col=tc; }
      return np;
    }
    function resolveTurn(pieces, player, act){
      var after = applyAction(pieces, act);
      var laser = getLaser(after, player);
      var path = [], eliminated = null;
      if(laser){
        var sim = simulateLaser(after, laser);
        path = sim.path; eliminated = sim.eliminated;
        if(eliminated) eliminated.alive = false;
      }
      return { np:after, path:path, eliminated:eliminated };
    }

    /* -------------------- AI -------------------- */
    function allActions(pieces, player){
      var acts = generateActions(pieces, player);
      acts.push({kind:"skip"});
      return acts;
    }
    function findKing(pieces, player){
      for(var i=0;i<pieces.length;i++){
        var p = pieces[i];
        if(p.alive && p.owner===player && p.type===KING) return p;
      }
      return null;
    }
    function laserPressure(pieces, player){
      var laser = getLaser(pieces, player);
      var king = findKing(pieces, 1-player);
      if(!laser || !king) return 0;
      var sim = simulateLaser(pieces, laser);
      var minDist = Infinity, turns = 0, enemyHalf = 0;
      var prevDir = -1;
      for(var i=0;i<sim.path.length;i++){
        var pt = sim.path[i];
        var dist = Math.abs(pt.r-king.row) + Math.abs(pt.c-king.col);
        if(dist < minDist) minDist = dist;
        if((player===1 && pt.r>=ROWS/2) || (player===0 && pt.r<ROWS/2)) enemyHalf++;
        if(i>0){
          var prev = sim.path[i-1];
          var dir = pt.r>prev.r ? DOWN : pt.r<prev.r ? UP : pt.c>prev.c ? RIGHT : LEFT;
          if(prevDir>=0 && dir!==prevDir) turns++;
          prevDir = dir;
        }
      }
      return Math.max(0, 12-minDist*3) + Math.min(sim.path.length, 14)*0.35 + turns*2 + enemyHalf*0.3;
    }
    function evaluatePosition(pieces, player, difficulty){
      var cfg = AI_LEVELS[difficulty] || AI_LEVELS.normal;
      var opp = 1 - player;
      var score = 0;
      for(var i=0;i<pieces.length;i++){
        var p = pieces[i];
        if(!p.alive) continue;
        var v = PIECE_VAL[p.type] || 0;
        score += (p.owner===player ? v : -v);
      }
      var myKing = findKing(pieces, player);
      score += laserPressure(pieces, player) * cfg.attack;
      score -= laserPressure(pieces, opp) * cfg.defense;
      if(myKing){
        var guards = 0;
        for(var j=0;j<pieces.length;j++){
          var pp = pieces[j];
          if(!pp.alive || pp.owner!==player || pp.type===KING || pp.type===LASER) continue;
          if(Math.abs(pp.row-myKing.row)+Math.abs(pp.col-myKing.col)<=2) guards++;
        }
        score += guards * cfg.guard;
      }
      return score;
    }
    function aiChoose(pieces, aiPlayer, difficulty){
      difficulty = AI_LEVELS[difficulty] ? difficulty : "normal";
      var cfg = AI_LEVELS[difficulty];
      var opp = 1 - aiPlayer;
      var acts = allActions(pieces, aiPlayer);
      var scored = acts.map(function(a){
        var s = 0, win = false, suicide = false;
        var res = resolveTurn(pieces, aiPlayer, a);
        if(res.eliminated){
          var e = res.eliminated;
          if(e.type===KING){
            if(e.owner===aiPlayer){ s=-100000; suicide=true; }
            else { s=100000; win=true; }
          } else {
            s += (e.owner===aiPlayer ? -PIECE_VAL[e.type] : PIECE_VAL[e.type]) * 4;
          }
        }
        if(!win && !suicide) s += evaluatePosition(res.np, aiPlayer, difficulty);
        return { a:a, s:s, win:win, suicide:suicide, res:res };
      });
      var wins = scored.filter(function(x){ return x.win; });
      if(wins.length) return wins[Math.floor(Math.random()*wins.length)].a;
      var safe = scored.filter(function(x){ return !x.suicide; });
      var pool = safe.length ? safe : scored;
      pool.sort(function(x,y){ return y.s - x.s; });
      var top = pool.slice(0, cfg.candidates);
      var finalList = [];
      for(var i=0;i<top.length;i++){
        var x = top[i];
        var s = x.s;
        if(cfg.reply>0 && s<50000){
          var oppActs = allActions(x.res.np, opp);
          var worstReply = Infinity, oppKillKing = false;
          for(var j=0;j<oppActs.length;j++){
            var oppRes = resolveTurn(x.res.np, opp, oppActs[j]);
            var replyScore = evaluatePosition(oppRes.np, aiPlayer, difficulty);
            if(oppRes.eliminated){
              var e2 = oppRes.eliminated;
              if(e2.type===KING){
                if(e2.owner===aiPlayer){ oppKillKing=true; replyScore=-100000; }
                else replyScore=100000;
              }
            }
            if(replyScore < worstReply) worstReply = replyScore;
            if(oppKillKing) break;
          }
          if(oppKillKing){ s -= 50000; }
          else if(worstReply<Infinity) s += worstReply * cfg.reply;
        }
        finalList.push({ a:x.a, s:s });
      }
      if(!finalList.length) return {kind:"skip"};
      finalList.sort(function(x,y){ return y.s - x.s; });
      var bestS = finalList[0].s;
      var eq = finalList.filter(function(x){ return x.s >= bestS - cfg.variety; });
      return eq[Math.floor(Math.random()*eq.length)].a;
    }

    /* -------------------- 保留区域（红色区只允许红方，白色区只允许蓝方） -------------------- */
    // 红色区域：只有红方(player 0)棋子可进入
    var RED_ZONES = {};
    [[6,9],[5,9],[4,9],[3,9],[2,9],[1,9],[0,9],[7,1],[0,1]].forEach(function(z){ RED_ZONES[z[0]+","+z[1]] = 1; });
    // 白色区域：只有蓝方(player 1)棋子可进入
    var BLUE_ZONES = {};
    [[7,0],[6,0],[5,0],[4,0],[3,0],[2,0],[1,0],[7,8],[0,8]].forEach(function(z){ BLUE_ZONES[z[0]+","+z[1]] = 1; });

    function isZoneAllowed(row, col, owner){
      var key = row + "," + col;
      if(owner === 0 && BLUE_ZONES[key]) return false; // 红方不能进蓝区
      if(owner === 1 && RED_ZONES[key]) return false;  // 蓝方不能进红区
      return true;
    }

    /* -------------------- 5种官方布局（Khet 2.0官方非对称阵型） -------------------- */
    var LAYOUTS = [
      {name:"幺点", en:"ACE", desc:"入门阵型，简单均衡",
       p0:[[LASER,7,9,UP],[SHIELD,7,5,LEFT],[KING,7,4,RIGHT],[SHIELD,7,3,LEFT],
           [MIRROR,7,2,UP],[MIRROR,6,7,RIGHT],[MIRROR,4,9,LEFT],
           [SWITCH,4,5,RIGHT],[SWITCH,4,4,DOWN],[MIRROR,4,2,UP],
           [MIRROR,3,9,UP],[MIRROR,3,2,LEFT],[MIRROR,2,3,UP]],
       p1:[[MIRROR,5,6,DOWN],[MIRROR,4,7,RIGHT],[MIRROR,4,0,DOWN],
           [MIRROR,3,7,DOWN],[SWITCH,3,5,DOWN],[SWITCH,3,4,RIGHT],
           [MIRROR,3,0,RIGHT],[MIRROR,1,2,LEFT],[MIRROR,0,7,DOWN],
           [SHIELD,0,6,RIGHT],[KING,0,5,RIGHT],[SHIELD,0,4,RIGHT],
           [LASER,0,0,DOWN]]},
      {name:"好奇", en:"CURIOSITY", desc:"镜面前推，开局更具进攻性",
       p0:[[LASER,7,9,UP],[SHIELD,7,5,LEFT],[KING,7,4,RIGHT],[SHIELD,7,3,LEFT],
           [SWITCH,7,2,DOWN],[MIRROR,5,3,LEFT],[MIRROR,4,9,LEFT],
           [SWITCH,4,4,DOWN],[MIRROR,4,1,UP],[MIRROR,3,9,UP],
           [MIRROR,3,4,DOWN],[MIRROR,3,1,LEFT],[MIRROR,2,3,UP]],
       p1:[[MIRROR,5,6,DOWN],[MIRROR,4,8,RIGHT],[MIRROR,4,5,UP],
           [MIRROR,4,0,DOWN],[MIRROR,3,8,DOWN],[SWITCH,3,5,DOWN],
           [MIRROR,3,0,RIGHT],[MIRROR,2,6,RIGHT],[SWITCH,0,7,DOWN],
           [SHIELD,0,6,RIGHT],[KING,0,5,RIGHT],[SHIELD,0,4,RIGHT],
           [LASER,0,0,DOWN]]},
      {name:"圣杯", en:"GRAIL", desc:"国王重兵把守，防御坚固",
       p0:[[LASER,7,9,UP],[MIRROR,7,5,RIGHT],[SHIELD,7,4,LEFT],[MIRROR,7,3,UP],
           [KING,6,4,RIGHT],[MIRROR,5,9,LEFT],[MIRROR,5,5,RIGHT],
           [SHIELD,5,4,LEFT],[SWITCH,5,3,DOWN],[MIRROR,4,9,UP],
           [SWITCH,4,7,RIGHT],[MIRROR,3,6,DOWN],[MIRROR,3,4,UP]],
       p1:[[MIRROR,4,5,DOWN],[MIRROR,4,3,UP],[SWITCH,3,2,RIGHT],
           [MIRROR,3,0,DOWN],[SWITCH,2,6,DOWN],[SHIELD,2,5,RIGHT],
           [MIRROR,2,4,LEFT],[MIRROR,2,0,RIGHT],[KING,1,5,RIGHT],
           [MIRROR,0,6,DOWN],[SHIELD,0,5,RIGHT],[MIRROR,0,4,LEFT],
           [LASER,0,0,DOWN]]},
      {name:"水星", en:"MERCURY", desc:"镜链复杂，反射路径多变",
       p0:[[LASER,7,9,UP],[MIRROR,7,5,RIGHT],[KING,7,4,RIGHT],[MIRROR,7,3,UP],
           [SHIELD,6,4,LEFT],[MIRROR,6,3,UP],[MIRROR,5,9,UP],
           [SWITCH,5,6,DOWN],[SHIELD,5,4,LEFT],[MIRROR,4,9,LEFT],
           [MIRROR,3,8,LEFT],[MIRROR,3,4,UP],[SWITCH,0,9,DOWN]],
       p1:[[SWITCH,7,0,DOWN],[MIRROR,4,5,DOWN],[MIRROR,4,1,RIGHT],
           [MIRROR,3,0,RIGHT],[SHIELD,2,5,RIGHT],[SWITCH,2,3,DOWN],
           [MIRROR,2,0,DOWN],[MIRROR,1,6,DOWN],[SHIELD,1,5,RIGHT],
           [MIRROR,0,6,DOWN],[KING,0,5,RIGHT],[MIRROR,0,4,LEFT],
           [LASER,0,0,DOWN]]},
      {name:"苏菲", en:"SOPHIE", desc:"棋子分散全盘，高阶对弈",
       p0:[[LASER,7,9,UP],[KING,7,5,RIGHT],[MIRROR,7,3,UP],
           [SHIELD,6,6,LEFT],[SHIELD,6,4,DOWN],[MIRROR,5,9,LEFT],
           [MIRROR,5,5,RIGHT],[MIRROR,5,4,UP],[SWITCH,4,2,RIGHT],
           [MIRROR,2,9,UP],[SWITCH,2,7,DOWN],[MIRROR,1,9,LEFT],
           [MIRROR,0,5,UP]],
       p1:[[MIRROR,7,4,DOWN],[MIRROR,6,0,RIGHT],[SWITCH,5,2,DOWN],
           [MIRROR,5,0,DOWN],[SWITCH,3,7,RIGHT],[MIRROR,2,5,DOWN],
           [MIRROR,2,4,LEFT],[MIRROR,2,0,RIGHT],[SHIELD,1,5,UP],
           [SHIELD,1,3,RIGHT],[MIRROR,0,6,DOWN],[KING,0,4,RIGHT],
           [LASER,0,0,DOWN]]},
    ];

    function makeInitialPieces(layoutIndex){
      layoutIndex = layoutIndex || 0;
      var layout = LAYOUTS[layoutIndex];
      var pieces = [];
      layout.p0.forEach(function(d, idx){
        pieces.push({id:"r"+idx, type:d[0], owner:0, row:d[1], col:d[2], orientation:d[3], alive:true});
      });
      layout.p1.forEach(function(d, idx){
        pieces.push({id:"b"+idx, type:d[0], owner:1, row:d[1], col:d[2], orientation:d[3], alive:true});
      });
      return pieces;
    }

    /* -------------------- 游戏状态 -------------------- */
    var DIFFICULTY_ORDER = ["easy", "normal", "hard"];
    var DIFFICULTY_LABEL = {easy:"简单", normal:"普通", hard:"困难"};
    var G = {
      pieces:[], current:0, phase:"select", sel:-1, mode:"pve", aiPlayer:1,
      difficulty:"normal",
      path:null, animT:0, over:false, winner:-1, busy:false,
      history:{}, drawOffer:false, modal:null, flashN:0, flashPiece:null,
      eliminated:null, layoutIdx:0, layoutPanel:false, undoSnapshot:null,
      particles:[], particleT:0
    };

    function startGame(){
      G.pieces = makeInitialPieces(G.layoutIdx);
      G.current=0; G.phase="select"; G.sel=-1;
      G.path=null; G.over=false; G.winner=-1; G.busy=false;
      G.history={}; G.drawOffer=false; G.modal=null;
      G.flashN=0; G.flashPiece=null; G.eliminated=null;
      G.layoutPanel=false; G.undoSnapshot=null;
      G.particles=[]; G.particleT=0;
      render();
    }
    function cycleDifficulty(){
      var i = DIFFICULTY_ORDER.indexOf(G.difficulty);
      G.difficulty = DIFFICULTY_ORDER[(i + 1) % DIFFICULTY_ORDER.length];
      render();
    }
    function signature(){
      var arr = [];
      for(var i=0;i<G.pieces.length;i++){
        var p = G.pieces[i];
        if(p.alive) arr.push(p.row+","+p.col+","+p.type+","+p.owner+","+p.orientation);
      }
      arr.sort();
      return arr.join("|") + "#" + G.current;
    }
    function recordState(){
      var k = signature();
      G.history[k] = (G.history[k]||0) + 1;
      if(G.history[k] >= 3) G.drawOffer = true;
    }

    /* -------------------- 颜色 -------------------- */
    function ownerColor(o, l){ return o===0 ? (l?"#ff4a4a":"#cc2020") : (l?"#3a8aff":"#1a4ad0"); }

    /* -------------------- 圆角矩形 -------------------- */
    function roundRect(x, y, w, h, r){
      r = Math.min(r, w/2, h/2);
      ctx.beginPath();
      ctx.moveTo(x+r, y);
      ctx.arcTo(x+w, y, x+w, y+h, r);
      ctx.arcTo(x+w, y+h, x, y+h, r);
      ctx.arcTo(x, y+h, x, y, r);
      ctx.arcTo(x, y, x+w, y, r);
      ctx.closePath();
    }

    /* -------------------- 3D 渲染辅助 -------------------- */
    function draw3DFaces(faces, proj){
      var sorted = faces.map(function(f){
        var depth = 0;
        for(var i=0;i<f.v.length;i++) depth += proj[f.v[i]].z;
        return { face:f, depth: depth / f.v.length };
      });
      sorted.sort(function(a,b){ return b.depth - a.depth; });
      for(var i=0;i<sorted.length;i++){
        var f = sorted[i].face;
        ctx.fillStyle = f.c;
        ctx.beginPath();
        ctx.moveTo(proj[f.v[0]].x, proj[f.v[0]].y);
        for(var j=1;j<f.v.length;j++) ctx.lineTo(proj[f.v[j]].x, proj[f.v[j]].y);
        ctx.closePath();
        ctx.fill();
        if(f.stroke){
          ctx.strokeStyle = f.stroke;
          ctx.lineWidth = f.lw || 1;
          ctx.stroke();
        }
      }
    }

    function draw3DBox(cx, cz, w, d, h, topColor, baseColor){
      var hw = w/2, hd = d/2;
      var verts = [
        [-hw,0,-hd],[hw,0,-hd],[hw,0,hd],[-hw,0,hd],
        [-hw,h,-hd],[hw,h,-hd],[hw,h,hd],[-hw,h,hd]
      ];
      var proj = verts.map(function(v){ return project3D(cx+v[0], v[1], cz+v[2]); });
      var dark = darkenColor(baseColor, 0.45);
      var mid = darkenColor(baseColor, 0.65);
      var faces = [
        {v:[0,1,5,4], c:dark, stroke:"rgba(0,0,0,0.3)", lw:1},
        {v:[1,2,6,5], c:mid, stroke:"rgba(0,0,0,0.3)", lw:1},
        {v:[2,3,7,6], c:darkenColor(baseColor,0.35), stroke:"rgba(0,0,0,0.3)", lw:1},
        {v:[3,0,4,7], c:mid, stroke:"rgba(0,0,0,0.3)", lw:1},
        {v:[4,5,6,7], c:topColor, stroke:"rgba(255,255,255,0.15)", lw:1}
      ];
      draw3DFaces(faces, proj);
      return proj;
    }

    /* -------------------- 3D 多部件组合渲染（统一深度排序） -------------------- */
    function drawComposite3D(cx, cz, parts){
      var allProj = [];
      var allFaces = [];
      for(var pi=0; pi<parts.length; pi++){
        var part = parts[pi];
        var hw = part.w/2, hd = part.d/2;
        var y0 = part.y0 || 0, h = part.h;
        var bi = allProj.length;
        var verts = [
          [-hw,y0,-hd],[hw,y0,-hd],[hw,y0,hd],[-hw,y0,hd],
          [-hw,y0+h,-hd],[hw,y0+h,-hd],[hw,y0+h,hd],[-hw,y0+h,hd]
        ];
        for(var vi=0; vi<8; vi++){
          allProj.push(project3D(cx+verts[vi][0], verts[vi][1], cz+verts[vi][2]));
        }
        var dark = darkenColor(part.baseColor, 0.45);
        var mid = darkenColor(part.baseColor, 0.65);
        var bk = darkenColor(part.baseColor, 0.35);
        allFaces.push({v:[bi+0,bi+1,bi+5,bi+4], c:dark, stroke:"rgba(0,0,0,0.3)", lw:1});
        allFaces.push({v:[bi+1,bi+2,bi+6,bi+5], c:mid, stroke:"rgba(0,0,0,0.3)", lw:1});
        allFaces.push({v:[bi+2,bi+3,bi+7,bi+6], c:bk, stroke:"rgba(0,0,0,0.3)", lw:1});
        allFaces.push({v:[bi+3,bi+0,bi+4,bi+7], c:mid, stroke:"rgba(0,0,0,0.3)", lw:1});
        allFaces.push({v:[bi+4,bi+5,bi+6,bi+7], c:part.topColor, stroke:"rgba(255,255,255,0.15)", lw:1});
      }
      draw3DFaces(allFaces, allProj);
    }

    function drawShadow3D(cx, cz, w, d){
      var hw = w*0.5, hd = d*0.5;
      var p1 = project3D(cx-hw, 0.005, cz-hd);
      var p2 = project3D(cx+hw, 0.005, cz-hd);
      var p3 = project3D(cx+hw, 0.005, cz+hd);
      var p4 = project3D(cx-hw, 0.005, cz+hd);
      ctx.fillStyle = "rgba(0,0,0,0.22)";
      ctx.beginPath();
      ctx.moveTo(p1.x,p1.y); ctx.lineTo(p2.x,p2.y);
      ctx.lineTo(p3.x,p3.y); ctx.lineTo(p4.x,p4.y);
      ctx.closePath(); ctx.fill();
    }

    function drawCellQuad3D(row, col, y, color, strokeColor, strokeW){
      var wx = col - (COLS-1)/2;
      var wz = row - (ROWS-1)/2;
      var hw = 0.5, hd = 0.5;
      var p1 = project3D(wx-hw, y, wz-hd);
      var p2 = project3D(wx+hw, y, wz-hd);
      var p3 = project3D(wx+hw, y, wz+hd);
      var p4 = project3D(wx-hw, y, wz+hd);
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(p1.x,p1.y); ctx.lineTo(p2.x,p2.y);
      ctx.lineTo(p3.x,p3.y); ctx.lineTo(p4.x,p4.y);
      ctx.closePath(); ctx.fill();
      if(strokeColor){
        ctx.strokeStyle = strokeColor;
        ctx.lineWidth = strokeW || 2;
        ctx.stroke();
      }
    }

    /* -------------------- 3D 棋盘渲染 -------------------- */
    function drawBoard3D(){
      var hw = COLS/2, hd = ROWS/2, th = 0.3;
      var verts = [
        [-hw,-th,-hd],[hw,-th,-hd],[hw,-th,hd],[-hw,-th,hd],
        [-hw,0,-hd],[hw,0,-hd],[hw,0,hd],[-hw,0,hd]
      ];
      var proj = verts.map(function(v){ return project3D(v[0], v[1], v[2]); });
      var faces = [
        {v:[0,1,5,4], c:"#2a2d38"},
        {v:[1,2,6,5], c:"#22242e"},
        {v:[2,3,7,6], c:"#1a1c24"},
        {v:[3,0,4,7], c:"#22242e"},
        {v:[4,5,6,7], c:"#3a3e4a"}
      ];
      draw3DFaces(faces, proj);

      // 格子底色（仅交替色，半透明叠加）
      for(var r=0;r<ROWS;r++){
        for(var c=0;c<COLS;c++){
          if((r+c)%2===0){
            drawCellQuad3D(r, c, 0.002, "rgba(80,86,100,0.35)", null, 0);
          }
        }
      }

      // 保留区域着色
      for(var r=0;r<ROWS;r++){
        for(var c=0;c<COLS;c++){
          var zkey = r + "," + c;
          if(RED_ZONES[zkey]){
            drawCellQuad3D(r, c, 0.003, "rgba(200,60,50,0.30)", null, 0);
            var cp1 = project3D(c - (COLS-1)/2, 0.01, r - (ROWS-1)/2);
            ctx.fillStyle = "rgba(220,80,70,0.55)";
            ctx.beginPath(); ctx.arc(cp1.x, cp1.y, cp1.s*0.16, 0, 6.283); ctx.fill();
          } else if(BLUE_ZONES[zkey]){
            drawCellQuad3D(r, c, 0.003, "rgba(240,240,245,0.25)", null, 0);
            var cp2 = project3D(c - (COLS-1)/2, 0.01, r - (ROWS-1)/2);
            ctx.fillStyle = "rgba(220,225,235,0.55)";
            ctx.beginPath(); ctx.arc(cp2.x, cp2.y, cp2.s*0.16, 0, 6.283); ctx.fill();
          }
        }
      }

      // 网格线
      ctx.strokeStyle = "rgba(255,255,255,0.12)";
      ctx.lineWidth = 1;
      for(var r2=0;r2<=ROWS;r2++){
        var z = r2 - ROWS/2;
        var a = project3D(-hw, 0.003, z);
        var b = project3D(hw, 0.003, z);
        ctx.beginPath(); ctx.moveTo(a.x,a.y); ctx.lineTo(b.x,b.y); ctx.stroke();
      }
      for(var c2=0;c2<=COLS;c2++){
        var x = c2 - COLS/2;
        var a2 = project3D(x, 0.003, -hd);
        var b2 = project3D(x, 0.003, hd);
        ctx.beginPath(); ctx.moveTo(a2.x,a2.y); ctx.lineTo(b2.x,b2.y); ctx.stroke();
      }

      // 选中高亮
      if(G.sel >= 0 && G.pieces[G.sel]){
        var sp = G.pieces[G.sel];
        if(sp.alive) drawCellQuad3D(sp.row, sp.col, 0.004, "rgba(255,225,77,0.15)", "#ffe14d", 2);
      }

      // 移动目标
      if(G.phase === "move" && G.sel >= 0){
        var selP = G.pieces[G.sel];
        if(selP){
          var targets = moveTargets(selP);
          for(var t=0;t<targets.length;t++){
            drawCellQuad3D(targets[t].r, targets[t].c, 0.004, "rgba(61,169,252,0.22)", "rgba(108,193,255,0.7)", 2);
            var wx2 = targets[t].c - (COLS-1)/2;
            var wz2 = targets[t].r - (ROWS-1)/2;
            var cp = project3D(wx2, 0.01, wz2);
            ctx.strokeStyle = "rgba(108,193,255,0.8)";
            ctx.lineWidth = 2;
            ctx.beginPath(); ctx.arc(cp.x, cp.y, cp.s*0.12, 0, 6.283); ctx.stroke();
          }
        }
      }
    }

    /* -------------------- 3D 棋子图标 -------------------- */
    function drawPieceIcon3D(p, wx, wz, ph){
      var pw = 0.72;
      var p4 = project3D(wx-pw/2, ph, wz-pw/2);
      var p5 = project3D(wx+pw/2, ph, wz-pw/2);
      var p7 = project3D(wx-pw/2, ph, wz+pw/2);
      var p6 = project3D(wx+pw/2, ph, wz+pw/2);
      var cx = (p4.x+p5.x+p6.x+p7.x)/4;
      var cy = (p4.y+p5.y+p6.y+p7.y)/4;
      var angle = Math.atan2(p5.y-p4.y, p5.x-p4.x);
      var w = Math.sqrt((p5.x-p4.x)*(p5.x-p4.x)+(p5.y-p4.y)*(p5.y-p4.y));
      var s = w / pw;

      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(angle);
      ctx.scale(s, s);

      if(p.type===KING) drawIconKing();
      else if(p.type===LASER) drawIconLaser(p.orientation);
      else if(p.type===SHIELD) drawIconShield(p.orientation);
      else if(p.type===MIRROR) drawIconMirror(p.orientation);
      else if(p.type===SWITCH) drawIconSwitch(p.orientation);

      ctx.restore();
    }

    /* -------------------- 3D 单面镜 — 竖立三棱柱，一面为镜面 -------------------- */
    function drawMirrorPrism3D(wx, wz, orientation, baseColor, liteColor){
      var sq2 = Math.SQRT1_2;
      var s = 0.72;       // 三角形缩放
      var hw = 0.42, hd = 0.42;
      var depth = s * hw * Math.SQRT2;  // 直角等腰三角形：depth = D/2，使两腿等长且直角在背面顶点
      var h = 0.70;       // 棱柱高度

      // project3D 中 z=-z 翻转了z轴，导致视觉对角线方向反转
      // 因此 isSlash 逻辑与 MIRROR_MAP 相反：偶数ori(0,2)是"/"逻辑但视觉为"\"，需要 isSlash=false 得到"/"视觉
      var isSlash = (orientation % 2 === 1);
      var p;
      if (isSlash) p = [sq2, -sq2];
      else         p = [sq2,  sq2];

      // 镜面朝向：需要根据 MIRROR_MAP 的折射方向确定哪一面是镜面
      // ori=0: 折射RIGHT→UP,DOWN→LEFT → 镜面朝NW(top-left) → 背面在SE
      // ori=1: 折射LEFT→UP,DOWN→RIGHT → 镜面朝NE(top-right) → 背面在SW
      // ori=2: 折射LEFT→DOWN,UP→RIGHT → 镜面朝SE(bottom-right) → 背面在NW
      // ori=3: 折射RIGHT→DOWN,UP→LEFT → 镜面朝SW(bottom-left) → 背面在NE
      var mirrorFront = (orientation >= 2) !== (orientation % 2 === 1);
      var backSign = mirrorFront ? -1 : 1;  // 第三顶点在镜面背面

      // 镜面边缘两端点（沿对角线方向，缩放后靠近格子对角）
      var e1, e2;
      if (isSlash) { e1 = [-hw*s, -hd*s]; e2 = [ hw*s,  hd*s]; }
      else         { e1 = [ hw*s, -hd*s]; e2 = [-hw*s,  hd*s]; }
      // 第三顶点（棱柱背面）
      var e3 = [p[0]*backSign*depth, p[1]*backSign*depth];

      // 6顶点：底面3 + 顶面3
      var verts = [
        [e1[0], 0, e1[1]],  // v0 底-镜面端1
        [e2[0], 0, e2[1]],  // v1 底-镜面端2
        [e3[0], 0, e3[1]],  // v2 底-背面顶点
        [e1[0], h, e1[1]],  // v3 顶-镜面端1
        [e2[0], h, e2[1]],  // v4 顶-镜面端2
        [e3[0], h, e3[1]],  // v5 顶-背面顶点
      ];
      var proj = verts.map(function(v){ return project3D(wx+v[0], v[1], wz+v[2]); });

      var dark = darkenColor(baseColor, 0.28);
      var mid = darkenColor(baseColor, 0.5);
      var vdark = darkenColor(baseColor, 0.2);
      var mirrorC = "rgba(200,240,255,0.92)";
      var mirrorStroke = "rgba(150,210,240,0.6)";

      var faces = [
        {v:[0,1,2], c:vdark, stroke:"rgba(0,0,0,0.3)", lw:1},              // 底面三角
        {v:[3,5,4], c:mid, stroke:"rgba(0,0,0,0.35)", lw:1},               // 顶面三角
        {v:[0,1,4,3], c:mirrorC, stroke:mirrorStroke, lw:1.5},             // 镜面（竖直矩形面）
        {v:[0,3,5,2], c:dark, stroke:"rgba(0,0,0,0.3)", lw:1},            // 背面1
        {v:[1,2,5,4], c:dark, stroke:"rgba(0,0,0,0.3)", lw:1},            // 背面2
      ];

      draw3DFaces(faces, proj);

      // 镜面高光线
      var mx1=(proj[0].x+proj[1].x)/2, my1=(proj[0].y+proj[1].y)/2;
      var mx2=(proj[3].x+proj[4].x)/2, my2=(proj[3].y+proj[4].y)/2;
      ctx.strokeStyle = "rgba(255,255,255,0.5)";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(mx1,my1); ctx.lineTo(mx2,my2);
      ctx.stroke();
    }

    /* -------------------- 3D 双面镜（Switch）— 竖直长方体，两面均镜面 -------------------- */
    function drawSwitchPrism3D(wx, wz, orientation, baseColor, liteColor){
      var sq2 = Math.SQRT1_2;
      var bw = 0.30;   // 沿对角线半宽
      var bh = 0.65;   // 高度
      var bt = 0.08;   // 垂直于对角线的半厚

      // project3D 中 z=-z 翻转了z轴，isSlash 逻辑与折射表相反
      var isSlash = (orientation % 2 === 1);
      var d, p;
      if (isSlash) { d = [sq2, sq2];  p = [sq2, -sq2]; }
      else         { d = [sq2, -sq2]; p = [sq2,  sq2]; }

      function vert(ds, ps, y) {
        return [d[0]*ds + p[0]*ps, y, d[1]*ds + p[1]*ps];
      }

      // 长方体8顶点
      var v0 = vert(-bw, -bt, 0);
      var v1 = vert(-bw,  bt, 0);
      var v2 = vert( bw, -bt, 0);
      var v3 = vert( bw,  bt, 0);
      var v4 = vert(-bw, -bt, bh);
      var v5 = vert(-bw,  bt, bh);
      var v6 = vert( bw, -bt, bh);
      var v7 = vert( bw,  bt, bh);

      var allVerts = [v0,v1,v2,v3,v4,v5,v6,v7];
      var proj = allVerts.map(function(v){ return project3D(wx+v[0], v[1], wz+v[2]); });

      var dark = darkenColor(baseColor, 0.28);
      var mid = darkenColor(baseColor, 0.5);
      var vdark = darkenColor(baseColor, 0.2);
      var mirrorC = "rgba(200,240,255,0.92)";
      var mirrorStroke = "rgba(150,210,240,0.6)";

      var faces = [
        {v:[1,3,7,5], c:mirrorC, stroke:mirrorStroke, lw:1.5},            // 前面（镜面）
        {v:[0,4,6,2], c:mirrorC, stroke:mirrorStroke, lw:1.5},            // 后面（镜面）
        {v:[0,1,5,4], c:liteColor, stroke:"rgba(0,0,0,0.35)", lw:1},     // 左端面
        {v:[2,6,7,3], c:mid, stroke:"rgba(0,0,0,0.35)", lw:1},           // 右端面
        {v:[4,5,7,6], c:dark, stroke:"rgba(0,0,0,0.3)", lw:1},           // 顶面
        {v:[0,2,3,1], c:vdark, stroke:"rgba(0,0,0,0.3)", lw:1},          // 底面
      ];

      draw3DFaces(faces, proj);

      // 双面镜面高光线
      ctx.strokeStyle = "rgba(255,255,255,0.4)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      var fmx1=(proj[1].x+proj[3].x)/2, fmy1=(proj[1].y+proj[3].y)/2;
      var fmx2=(proj[5].x+proj[7].x)/2, fmy2=(proj[5].y+proj[7].y)/2;
      var bmx1=(proj[0].x+proj[2].x)/2, bmy1=(proj[0].y+proj[2].y)/2;
      var bmx2=(proj[4].x+proj[6].x)/2, bmy2=(proj[4].y+proj[6].y)/2;
      ctx.moveTo(fmx1,fmy1); ctx.lineTo(fmx2,fmy2);
      ctx.moveTo(bmx1,bmy1); ctx.lineTo(bmx2,bmy2);
      ctx.stroke();
    }

    /* -------------------- 3D 圆柱激光炮台 -------------------- */
    function drawLaserCylinder3D(wx, wz, orientation, baseColor, liteColor){
      var r = 0.32, h = 0.5;
      var segs = 10;
      var proj = [];
      for(var i=0;i<segs;i++){
        var a = (i/segs)*Math.PI*2;
        proj.push(project3D(wx+Math.cos(a)*r, 0, wz+Math.sin(a)*r));
      }
      for(var j=0;j<segs;j++){
        var a2 = (j/segs)*Math.PI*2;
        proj.push(project3D(wx+Math.cos(a2)*r, h, wz+Math.sin(a2)*r));
      }
      var faces = [];
      for(var k=0;k<segs;k++){
        var ni = (k+1)%segs;
        var shade = 0.35 + 0.35 * Math.abs(Math.cos((k/segs)*Math.PI*2));
        faces.push({v:[k,ni,ni+segs,k+segs], c:darkenColor(baseColor, shade), stroke:"rgba(0,0,0,0.2)", lw:0.5});
      }
      var topV = [];
      for(var m=0;m<segs;m++) topV.push(m+segs);
      faces.push({v:topV, c:liteColor, stroke:"rgba(0,0,0,0.3)", lw:1});
      draw3DFaces(faces, proj);

      // 炮管（矩形指向激光方向）
      var dir = orientation;
      var barrelLen = 0.35, barrelW = 0.14;
      var dx = DX[dir], dz = DY[dir]; // 世界坐标方向（project3D内部会处理z翻转）
      var bx = wx + dx * barrelLen * 0.5;
      var bz = wz + dz * barrelLen * 0.5;
      var ph2 = h + 0.15;
      // 根据朝向决定炮管的长宽方向：水平方向时宽=长、深=窄；垂直方向时宽=窄、深=长
      var bw = (dx !== 0) ? barrelLen : barrelW;
      var bd = (dx !== 0) ? barrelW : barrelLen;
      draw3DBox(bx, bz, bw, bd, ph2, "#4a4a5e", "#2a2a3e");

      // 发射口光晕
      var tipX = wx + dx * barrelLen;
      var tipZ = wz + dz * barrelLen;
      var tipProj = project3D(tipX, h + 0.2, tipZ);
      var g = ctx.createRadialGradient(tipProj.x, tipProj.y, 0, tipProj.x, tipProj.y, tipProj.s * 0.2);
      g.addColorStop(0, "rgba(255,255,200,0.9)");
      g.addColorStop(0.5, "rgba(255,180,50,0.5)");
      g.addColorStop(1, "rgba(255,100,0,0)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(tipProj.x, tipProj.y, tipProj.s * 0.2, 0, 6.283);
      ctx.fill();
    }

    /* -------------------- 3D 国王塔楼 -------------------- */
    function drawKingTower3D(wx, wz, baseColor, liteColor){
      drawComposite3D(wx, wz, [
        {w:0.72, d:0.72, y0:0,    h:0.12, topColor:liteColor, baseColor:baseColor},
        {w:0.54, d:0.54, y0:0.12, h:0.55, topColor:liteColor, baseColor:baseColor},
        {w:0.60, d:0.60, y0:0.67, h:0.10, topColor:"#ffd700", baseColor:"#daa520"},
        {w:0.20, d:0.20, y0:0.77, h:0.25, topColor:"#ff4a4a", baseColor:"#cc2020"}
      ]);
    }

    /* -------------------- 3D 护盾 — 锥形盾体+金属面板+金色盾心 -------------------- */
    function drawShieldBlock3D(wx, wz, orientation, baseColor, liteColor){
      var hw = 0.36, hd = 0.28;
      var frontC = "rgba(225,230,245,0.95)";

      // 锥形盾体（下宽上窄，模拟盾牌轮廓）
      drawComposite3D(wx, wz, [
        {w:0.72, d:0.56, y0:0,    h:0.10, topColor:liteColor, baseColor:baseColor},
        {w:0.68, d:0.56, y0:0.10, h:0.22, topColor:liteColor, baseColor:baseColor},
        {w:0.54, d:0.56, y0:0.32, h:0.18, topColor:liteColor, baseColor:baseColor},
        {w:0.34, d:0.56, y0:0.50, h:0.15, topColor:liteColor, baseColor:baseColor}
      ]);

      // 朝向方向的前金属面板
      var dx = DX[orientation], dz = DY[orientation];
      var plateCX = wx, plateCZ = wz, plateW, plateD;
      if(dz !== 0){
        plateW = 0.58; plateD = 0.06;
        plateCZ = wz + dz * (hd + plateD/2);
      } else {
        plateW = 0.06; plateD = 0.58;
        plateCX = wx + dx * (hw + plateW/2);
      }
      drawComposite3D(plateCX, plateCZ, [
        {w:plateW, d:plateD, y0:0.04, h:0.55, topColor:frontC, baseColor:"#778"}
      ]);

      // 盾心凸起（金色铆钉）
      var bossCX = wx, bossCZ = wz, bossW = 0.16, bossD = 0.16;
      if(dz !== 0){
        bossCZ = wz + dz * (hd + bossD/2);
      } else {
        bossCX = wx + dx * (hw + bossW/2);
      }
      drawComposite3D(bossCX, bossCZ, [
        {w:bossW, d:bossD, y0:0.18, h:0.22, topColor:"#ffd700", baseColor:"#daa520"}
      ]);
    }

    function drawIconKing(){
      // 城堡塔楼造型：城墙底座 + 塔楼 + 城垛 + 顶部十字宝石
      var r = 0.24;
      // 底座（略宽）
      ctx.fillStyle = "#daa520";
      ctx.strokeStyle = "#8b6914";
      ctx.lineWidth = 0.018;
      ctx.beginPath();
      ctx.moveTo(-r*0.85, r*0.85);
      ctx.lineTo(r*0.85, r*0.85);
      ctx.lineTo(r*0.7, r*0.55);
      ctx.lineTo(-r*0.7, r*0.55);
      ctx.closePath();
      ctx.fill(); ctx.stroke();
      // 塔楼主体
      ctx.fillStyle = "#ffd700";
      ctx.beginPath();
      ctx.moveTo(-r*0.6, r*0.55);
      ctx.lineTo(r*0.6, r*0.55);
      ctx.lineTo(r*0.6, -r*0.15);
      ctx.lineTo(-r*0.6, -r*0.15);
      ctx.closePath();
      ctx.fill(); ctx.stroke();
      // 城垛（顶部齿状）
      ctx.fillStyle = "#ffd700";
      var mw = r*0.2, gap = r*0.1;
      for(var i=0; i<3; i++){
        var mx = -r*0.6 + i*(mw*2+gap);
        ctx.beginPath();
        ctx.moveTo(mx, -r*0.15);
        ctx.lineTo(mx+mw, -r*0.15);
        ctx.lineTo(mx+mw, -r*0.35);
        ctx.lineTo(mx, -r*0.35);
        ctx.closePath();
        ctx.fill(); ctx.stroke();
      }
      // 城门
      ctx.fillStyle = "#5a3e08";
      ctx.beginPath();
      ctx.moveTo(-r*0.15, r*0.55);
      ctx.lineTo(-r*0.15, r*0.3);
      ctx.arc(0, r*0.3, r*0.15, Math.PI, 0);
      ctx.lineTo(r*0.15, r*0.55);
      ctx.closePath();
      ctx.fill();
      // 顶部十字 + 宝石
      ctx.strokeStyle = "#ff4444";
      ctx.lineWidth = 0.035;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(0, -r*0.35); ctx.lineTo(0, -r*0.75);
      ctx.moveTo(-r*0.12, -r*0.55); ctx.lineTo(r*0.12, -r*0.55);
      ctx.stroke();
      ctx.fillStyle = "#ff2244";
      ctx.beginPath(); ctx.arc(0, -r*0.78, r*0.08, 0, 6.283); ctx.fill();
      // 高光
      ctx.fillStyle = "rgba(255,255,255,0.25)";
      ctx.fillRect(-r*0.55, -r*0.12, r*0.2, r*0.6);
    }

    function drawIconLaser(orientation){
      // 圆柱炮台造型：底座圆环 + 镜筒 + 发射口光晕
      ctx.save();
      ctx.rotate(orientation * Math.PI / 2);
      var r = 0.22;
      // 底座圆环
      ctx.fillStyle = "#2a2a3e";
      ctx.strokeStyle = "#555";
      ctx.lineWidth = 0.02;
      ctx.beginPath(); ctx.arc(0, r*0.2, r*0.7, 0, 6.283); ctx.fill(); ctx.stroke();
      // 镜筒（矩形炮管）
      ctx.fillStyle = "#3a3a4e";
      ctx.strokeStyle = "#666";
      ctx.lineWidth = 0.018;
      ctx.beginPath();
      ctx.moveTo(-r*0.2, -r*0.6);
      ctx.lineTo(r*0.2, -r*0.6);
      ctx.lineTo(r*0.2, r*0);
      ctx.lineTo(-r*0.2, r*0);
      ctx.closePath();
      ctx.fill(); ctx.stroke();
      // 发射口光晕
      var g = ctx.createRadialGradient(0, -r*0.6, 0, 0, -r*0.6, r*0.35);
      g.addColorStop(0, "rgba(255,255,200,1)");
      g.addColorStop(0.5, "rgba(255,180,50,0.6)");
      g.addColorStop(1, "rgba(255,100,0,0)");
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(0, -r*0.6, r*0.35, 0, 6.283); ctx.fill();
      // 发射口核心
      ctx.fillStyle = "#fffbe6";
      ctx.beginPath(); ctx.arc(0, -r*0.6, r*0.1, 0, 6.283); ctx.fill();
      // 方向箭头
      ctx.strokeStyle = "rgba(255,225,77,0.9)";
      ctx.lineWidth = 0.03;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(0, -r*0.7); ctx.lineTo(0, -r*0.95);
      ctx.moveTo(-r*0.08, -r*0.85); ctx.lineTo(0, -r*0.95); ctx.lineTo(r*0.08, -r*0.85);
      ctx.stroke();
      ctx.restore();
    }

    function drawIconShield(orientation){
      // 盾牌造型：弧面盾 + 加厚防面 + 中心铆钉
      ctx.save();
      ctx.rotate(orientation * Math.PI / 2);
      var r = 0.22;
      // 盾牌主体
      ctx.fillStyle = "rgba(220,225,240,0.92)";
      ctx.strokeStyle = "rgba(40,50,70,0.8)";
      ctx.lineWidth = 0.02;
      ctx.beginPath();
      ctx.moveTo(-r*0.75, -r*0.55);
      ctx.lineTo(r*0.75, -r*0.55);
      ctx.lineTo(r*0.75, r*0.2);
      ctx.quadraticCurveTo(r*0.75, r*0.7, 0, r*0.8);
      ctx.quadraticCurveTo(-r*0.75, r*0.7, -r*0.75, r*0.2);
      ctx.closePath();
      ctx.fill(); ctx.stroke();
      // 加厚防护面（顶部条带，表示挡面方向）
      ctx.fillStyle = "rgba(60,80,120,0.85)";
      ctx.beginPath();
      ctx.moveTo(-r*0.75, -r*0.55);
      ctx.lineTo(r*0.75, -r*0.55);
      ctx.lineTo(r*0.75, -r*0.3);
      ctx.lineTo(-r*0.75, -r*0.3);
      ctx.closePath();
      ctx.fill();
      // 防护面铆钉
      ctx.fillStyle = "rgba(180,200,230,0.9)";
      for(var i=0; i<3; i++){
        ctx.beginPath();
        ctx.arc(-r*0.45+i*r*0.45, -r*0.42, r*0.05, 0, 6.283);
        ctx.fill();
      }
      // 中心十字纹章
      ctx.strokeStyle = "rgba(60,80,120,0.7)";
      ctx.lineWidth = 0.025;
      ctx.beginPath();
      ctx.moveTo(0, -r*0.2); ctx.lineTo(0, r*0.4);
      ctx.moveTo(-r*0.25, r*0.1); ctx.lineTo(r*0.25, r*0.1);
      ctx.stroke();
      // 高光
      ctx.fillStyle = "rgba(255,255,255,0.2)";
      ctx.beginPath();
      ctx.moveTo(-r*0.65, -r*0.5);
      ctx.lineTo(-r*0.3, -r*0.5);
      ctx.lineTo(-r*0.3, r*0.3);
      ctx.quadraticCurveTo(-r*0.5, r*0.5, -r*0.65, r*0.2);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }

    function drawIconMirror(orientation){
      // 三棱镜造型：直角三角形，斜边为镜面（亮银色+反光线），其余两边为暗背板
      var r = 0.24;
      var TL={x:-r,y:-r}, TR={x:r,y:-r}, BL={x:-r,y:r}, BR={x:r,y:r};
      var tri, m1, m2, dark1, dark2;
      // orientation 0,2 = "/" 镜面 (BL→TR)
      // orientation 1,3 = "\" 镜面 (TL→BR)
      if(orientation===0){ // "/" 厚端在SE(BR)
        tri=[BL,TR,BR]; m1=BL; m2=TR; dark1=[BL,BR]; dark2=[BR,TR];
      } else if(orientation===1){ // "\" 厚端在SW(BL)
        tri=[TL,BR,BL]; m1=TL; m2=BR; dark1=[TL,BL]; dark2=[BL,BR];
      } else if(orientation===2){ // "/" 厚端在NW(TL)
        tri=[BL,TR,TL]; m1=BL; m2=TR; dark1=[BL,TL]; dark2=[TL,TR];
      } else { // "\" 厚端在NE(TR)
        tri=[TL,BR,TR]; m1=TL; m2=BR; dark1=[TL,TR]; dark2=[TR,BR];
      }
      // 暗背板填充
      ctx.fillStyle = "rgba(35,40,55,0.92)";
      ctx.strokeStyle = "rgba(0,0,0,0.5)";
      ctx.lineWidth = 0.018;
      ctx.beginPath();
      ctx.moveTo(tri[0].x, tri[0].y);
      ctx.lineTo(tri[1].x, tri[1].y);
      ctx.lineTo(tri[2].x, tri[2].y);
      ctx.closePath();
      ctx.fill(); ctx.stroke();
      // 镜面（斜边）：亮银色粗线 + 反光高亮
      ctx.strokeStyle = "rgba(180,230,255,0.95)";
      ctx.lineWidth = 0.08;
      ctx.lineCap = "round";
      ctx.beginPath(); ctx.moveTo(m1.x,m1.y); ctx.lineTo(m2.x,m2.y); ctx.stroke();
      // 镜面高光线（内侧细线）
      ctx.strokeStyle = "rgba(255,255,255,0.7)";
      ctx.lineWidth = 0.03;
      ctx.beginPath(); ctx.moveTo(m1.x,m1.y); ctx.lineTo(m2.x,m2.y); ctx.stroke();
      // 反光斜线（3条短斜线表示镜面光泽）
      var dx = m2.x-m1.x, dy = m2.y-m1.y;
      var len = Math.sqrt(dx*dx+dy*dy);
      var nx = -dy/len, ny = dx/len; // 法线方向
      ctx.strokeStyle = "rgba(255,255,255,0.4)";
      ctx.lineWidth = 0.015;
      for(var i=1; i<=3; i++){
        var t = i*0.25;
        var px = m1.x+dx*t, py = m1.y+dy*t;
        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.lineTo(px - nx*r*0.12, py - ny*r*0.12);
        ctx.stroke();
      }
    }

    function drawIconSwitch(orientation){
      // 双面镜造型：菱形，两条对角线均为镜面
      var r = 0.22;
      var slash = (orientation%2===0); // true="/", false="\"
      // 菱形外形
      ctx.fillStyle = "rgba(60,70,90,0.85)";
      ctx.strokeStyle = "rgba(0,0,0,0.4)";
      ctx.lineWidth = 0.018;
      ctx.beginPath();
      ctx.moveTo(0, -r*1.1);
      ctx.lineTo(r*1.1, 0);
      ctx.lineTo(0, r*1.1);
      ctx.lineTo(-r*1.1, 0);
      ctx.closePath();
      ctx.fill(); ctx.stroke();
      // 两条镜面线（双面反射）
      ctx.strokeStyle = "rgba(180,230,255,0.95)";
      ctx.lineWidth = 0.07;
      ctx.lineCap = "round";
      if(slash){
        // "/" 方向
        ctx.beginPath();
        ctx.moveTo(-r*0.9, r*0.5); ctx.lineTo(r*0.9, -r*0.5);
        ctx.stroke();
      } else {
        // "\" 方向
        ctx.beginPath();
        ctx.moveTo(-r*0.9, -r*0.5); ctx.lineTo(r*0.9, r*0.5);
        ctx.stroke();
      }
      // 镜面高光
      ctx.strokeStyle = "rgba(255,255,255,0.6)";
      ctx.lineWidth = 0.025;
      if(slash){
        ctx.beginPath();
        ctx.moveTo(-r*0.9, r*0.5); ctx.lineTo(r*0.9, -r*0.5);
        ctx.stroke();
      } else {
        ctx.beginPath();
        ctx.moveTo(-r*0.9, -r*0.5); ctx.lineTo(r*0.9, r*0.5);
        ctx.stroke();
      }
      // 双面标识：两侧各画短反光线
      ctx.strokeStyle = "rgba(255,255,255,0.35)";
      ctx.lineWidth = 0.012;
      var pts = slash ? [[-r*0.4,r*0.2],[r*0.4,-r*0.2]] : [[-r*0.4,-r*0.2],[r*0.4,r*0.2]];
      for(var i=0; i<pts.length; i++){
        var px = pts[i][0], py = pts[i][1];
        ctx.beginPath();
        ctx.arc(px, py, r*0.06, 0, 6.283);
        ctx.stroke();
      }
    }

    /* -------------------- 3D 棋子渲染 -------------------- */
    function drawPieces3D(){
      var drawList = [];
      for(var i=0;i<G.pieces.length;i++){
        var p = G.pieces[i];
        if(!p.alive) continue;
        var wx = p.col - (COLS-1)/2;
        var wz = p.row - (ROWS-1)/2;
        var proj = project3D(wx, 0, wz);
        drawList.push({ piece:p, depth:proj.z });
      }
      drawList.sort(function(a,b){ return b.depth - a.depth; });
      for(var j=0;j<drawList.length;j++){
        drawPiece3D(drawList[j].piece);
      }
    }

    function drawPiece3D(p){
      var wx = p.col - (COLS-1)/2;
      var wz = p.row - (ROWS-1)/2;
      var pw = 0.72, pd = 0.72;
      var ph = pieceHeight(p.type);
      var base = ownerColor(p.owner, false);
      var lite = ownerColor(p.owner, true);

      // 镜子和双面镜使用3D棱柱造型
      if(p.type === MIRROR){
        drawShadow3D(wx, wz, pw, pd);
        drawMirrorPrism3D(wx, wz, p.orientation, base, lite);
        return;
      }
      if(p.type === SWITCH){
        drawShadow3D(wx, wz, pw, pd);
        drawSwitchPrism3D(wx, wz, p.orientation, base, lite);
        return;
      }
      // 激光使用圆柱炮台造型
      if(p.type === LASER){
        drawShadow3D(wx, wz, pw, pd);
        drawLaserCylinder3D(wx, wz, p.orientation, base, lite);
        return;
      }
      // 国王使用3D塔楼造型（立起来）
      if(p.type === KING){
        drawShadow3D(wx, wz, pw, pd);
        drawKingTower3D(wx, wz, base, lite);
        return;
      }
      // 护盾使用3D墙壁造型（立起来）
      if(p.type === SHIELD){
        drawShadow3D(wx, wz, pw, pd);
        drawShieldBlock3D(wx, wz, p.orientation, base, lite);
        return;
      }
    }

    /* -------------------- 3D 激光束渲染 -------------------- */
    function drawBeam3D(){
      if(!G.path || !Array.isArray(G.path) || G.path.length < 2) return;
      var prog = G.animT || 0;
      var n = G.path.length;
      var total = n - 1;
      var upto = prog * total;
      if(!isFinite(upto)) return;
      var beamH = 0.35;
      var pts = [];
      for(var i=0;i<n;i++){
        var wx = G.path[i].c - (COLS-1)/2;
        var wz = G.path[i].r - (ROWS-1)/2;
        pts.push(project3D(wx, beamH, wz));
      }
      ctx.save();
      ctx.lineCap = "round"; ctx.lineJoin = "round";
      var baseLW = Math.max(6, cam.focal / cam.dist * 0.15);
      ctx.strokeStyle = "rgba(255,225,77,0.2)"; ctx.lineWidth = baseLW * 2.5;
      beamPath3D(pts, upto); ctx.stroke();
      ctx.strokeStyle = "#ffe14d"; ctx.lineWidth = baseLW;
      beamPath3D(pts, upto); ctx.stroke();
      ctx.strokeStyle = "#fffbe6"; ctx.lineWidth = baseLW * 0.35;
      beamPath3D(pts, upto); ctx.stroke();
      if(upto < total && upto >= 0){
        var idx = Math.floor(upto), frac = upto - idx;
        if(idx >= 0 && idx < n-1){
          var a = pts[idx], b = pts[idx+1];
          var hx = a.x + (b.x-a.x)*frac, hy = a.y + (b.y-a.y)*frac;
          var g = ctx.createRadialGradient(hx, hy, 0, hx, hy, baseLW*3);
          g.addColorStop(0, "rgba(255,255,255,0.9)");
          g.addColorStop(1, "rgba(255,225,77,0)");
          ctx.fillStyle = g;
          ctx.beginPath(); ctx.arc(hx, hy, baseLW*3, 0, 6.283); ctx.fill();
        }
      }
      ctx.restore();
    }
    function beamPath3D(pts, upto){
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for(var i=0;i<pts.length-1;i++){
        if(upto >= i+1){
          ctx.lineTo(pts[i+1].x, pts[i+1].y);
        } else if(upto > i){
          var f = upto - i;
          ctx.lineTo(pts[i].x+(pts[i+1].x-pts[i].x)*f, pts[i].y+(pts[i+1].y-pts[i].y)*f);
          break;
        } else break;
      }
    }

    /* -------------------- 3D 闪烁特效 -------------------- */
    function drawFlash3D(){
      if(!G.flashPiece) return;
      if(G.flashN % 2 === 0){
        drawCellQuad3D(G.flashPiece.row, G.flashPiece.col, 0.006, "rgba(255,90,110,0.6)", null, 0);
      }
    }

    /* -------------------- 3D 粒子爆炸特效 -------------------- */
    function spawnExplosion3D(piece){
      var wx = piece.col - (COLS-1)/2;
      var wz = piece.row - (ROWS-1)/2;
      var ph = pieceHeight(piece.type) * 0.5;
      G.particles = [];
      var colors = ["#ffe14d","#ff6b3a","#ff4a4a","#fffbe6"];
      var n = 8;
      for(var i=0;i<n;i++){
        var theta = (i/n)*Math.PI*2 + Math.random()*0.5;
        var phi = Math.random()*Math.PI*0.5 + 0.2;
        var speed = 0.6 + Math.random()*0.8;
        G.particles.push({
          x: wx, y: ph, z: wz,
          vx: Math.cos(theta)*Math.sin(phi)*speed,
          vy: Math.cos(phi)*speed + 0.5,
          vz: Math.sin(theta)*Math.sin(phi)*speed,
          life: 0.3 + Math.random()*0.15,
          maxLife: 0.45,
          size: 1.5 + Math.random()*1.5,
          color: colors[Math.floor(Math.random()*colors.length)]
        });
      }
      // 中心闪光环（小）
      G.particles.push({
        x: wx, y: ph, z: wz, vx:0, vy:0, vz:0,
        life: 0.2, maxLife: 0.2, size: 12, color: "#fffbe6", ring: true
      });
      G.particleT = Date.now();
    }

    function updateParticles(dt){
      if(!G.particles || G.particles.length === 0) return;
      for(var i=G.particles.length-1;i>=0;i--){
        var p = G.particles[i];
        p.life -= dt;
        if(p.life <= 0){ G.particles.splice(i,1); continue; }
        if(!p.ring){
          p.x += p.vx * dt;
          p.y += p.vy * dt;
          p.z += p.vz * dt;
          p.vy -= 4.0 * dt; // 重力
          p.vx *= 0.96;
          p.vz *= 0.96;
        }
      }
    }

    function drawParticles3D(){
      if(!G.particles || G.particles.length === 0) return;
      ctx.save();
      for(var i=0;i<G.particles.length;i++){
        var p = G.particles[i];
        var proj = project3D(p.x, Math.max(0, p.y), p.z);
        var alpha = Math.max(0, p.life / p.maxLife);
        if(p.ring){
          // 扩散光环
          var ringR = p.size * (1 - alpha) * 3 + p.size * 0.5;
          var g = ctx.createRadialGradient(proj.x, proj.y, 0, proj.x, proj.y, ringR);
          g.addColorStop(0, "rgba(255,251,230," + (alpha*0.8) + ")");
          g.addColorStop(0.5, "rgba(255,225,77," + (alpha*0.4) + ")");
          g.addColorStop(1, "rgba(255,90,58,0)");
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.arc(proj.x, proj.y, ringR, 0, 6.283);
          ctx.fill();
        } else {
          // 粒子点
          var sz = p.size * proj.s * 0.8;
          sz = Math.max(1.5, sz);
          var g2 = ctx.createRadialGradient(proj.x, proj.y, 0, proj.x, proj.y, sz*2);
          g2.addColorStop(0, p.color);
          g2.addColorStop(0.4, p.color);
          g2.addColorStop(1, "rgba(255,100,50,0)");
          ctx.globalAlpha = alpha;
          ctx.fillStyle = g2;
          ctx.beginPath();
          ctx.arc(proj.x, proj.y, sz*2, 0, 6.283);
          ctx.fill();
          ctx.globalAlpha = 1;
          ctx.fillStyle = p.color;
          ctx.beginPath();
          ctx.arc(proj.x, proj.y, sz*0.6, 0, 6.283);
          ctx.fill();
        }
      }
      ctx.restore();
    }

    /* -------------------- 按钮系统 -------------------- */
    var BUTTONS = [];
    var ONBOARD = [];
    function addBtn(label, fn, style){ BUTTONS.push({label:label, fn:fn, style:style||""}); }
    function layoutButtons(){
      var areaY = SH - SAFE_BOT - btnAreaH;
      var rows = [], row = [];
      for(var i=0;i<BUTTONS.length;i++){
        row.push(BUTTONS[i]);
        if(row.length >= 4){ rows.push(row); row = []; }
      }
      if(row.length) rows.push(row);
      var y = areaY;
      for(var r=0;r<rows.length;r++){
        var n = rows[r].length;
        var totalW = SW - 24;
        var bw = (totalW - BTN_GAP*(n-1)) / n;
        var x = 12;
        for(var c=0;c<n;c++){
          rows[r][c].x = x; rows[r][c].y = y; rows[r][c].w = bw; rows[r][c].h = BTN_H;
          x += bw + BTN_GAP;
        }
        y += BTN_H + BTN_GAP;
      }
    }
    function hitButton(x, y){
      for(var i=0;i<BUTTONS.length;i++){
        var b = BUTTONS[i];
        if(x>=b.x && x<=b.x+b.w && y>=b.y && y<=b.y+b.h) return b;
      }
      return null;
    }
    function drawButton(b){
      var fill = "#222b48", stroke = "#2e3a5e", txt = "#e8ecf5";
      if(b.style === "primary"){ fill = "#3da9fc"; stroke = "#3da9fc"; txt = "#06101f"; }
      if(b.style === "danger"){ fill = "#ff5a6e"; stroke = "#ff5a6e"; txt = "#2a0610"; }
      if(b.style === "ghost"){ fill = "rgba(34,43,72,0.6)"; }
      ctx.fillStyle = fill;
      roundRect(b.x, b.y, b.w, b.h, 10); ctx.fill();
      ctx.strokeStyle = stroke; ctx.lineWidth = 1; ctx.stroke();
      ctx.fillStyle = txt;
      ctx.font = "600 15px sans-serif";
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText(b.label, b.x + b.w/2, b.y + b.h/2 + 1);
    }

    /* -------------------- 棋盘上旋转按钮（3D投影位置） -------------------- */
    function buildOnBoardButtons3D(){
      ONBOARD = [];
      if(G.phase !== "move" || G.sel < 0 || G.busy || G.over) return;
      var p = G.pieces[G.sel];
      if(!p || !p.alive) return;
      var wx = p.col - (COLS-1)/2;
      var wz = p.row - (ROWS-1)/2;
      var ph = pieceHeight(p.type);
      var proj = project3D(wx, ph + 0.2, wz);
      var btnR = 20, spread = 34, offset = 38;
      if(p.type === LASER){
        ONBOARD.push({ cx:proj.x, cy:proj.y-offset, r:btnR, label:"\u21BB", fn:doLaserToggle });
      } else {
        ONBOARD.push({ cx:proj.x-spread, cy:proj.y-offset, r:btnR, label:"\u21BA", fn:function(){ doRotate(3); } });
        ONBOARD.push({ cx:proj.x+spread, cy:proj.y-offset, r:btnR, label:"\u21BB", fn:function(){ doRotate(1); } });
      }
    }
    function drawOnBoardButtons3D(){
      for(var i=0;i<ONBOARD.length;i++){
        var b = ONBOARD[i];
        var glow = ctx.createRadialGradient(b.cx, b.cy, 0, b.cx, b.cy, b.r*1.8);
        glow.addColorStop(0, "rgba(108,193,255,0.4)");
        glow.addColorStop(1, "rgba(108,193,255,0)");
        ctx.fillStyle = glow;
        ctx.beginPath(); ctx.arc(b.cx, b.cy, b.r*1.8, 0, 6.283); ctx.fill();
        ctx.fillStyle = "rgba(61,169,252,0.92)";
        ctx.strokeStyle = "#6bc1ff"; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(b.cx, b.cy, b.r, 0, 6.283); ctx.fill(); ctx.stroke();
        ctx.fillStyle = "rgba(255,255,255,0.25)";
        ctx.beginPath(); ctx.arc(b.cx-b.r*0.3, b.cy-b.r*0.3, b.r*0.4, 0, 6.283); ctx.fill();
        ctx.fillStyle = "#fff";
        ctx.font = "700 22px sans-serif";
        ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.fillText(b.label, b.cx, b.cy + 1);
      }
    }
    function hitOnBoard3D(x, y){
      for(var i=0;i<ONBOARD.length;i++){
        var b = ONBOARD[i];
        var dx = x-b.cx, dy = y-b.cy;
        if(dx*dx+dy*dy <= (b.r+6)*(b.r+6)) return b;
      }
      return null;
    }

    /* -------------------- 主渲染 -------------------- */
    function render(){
      try {
        BUTTONS = [];
        ctx.fillStyle = "#0a0e1a";
        ctx.fillRect(0, 0, SW, SH);

        drawBackground3D();
        drawTopBar();
        drawBoard3D();
        drawPieces3D();
        if(G.flashN > 0 && G.flashPiece) drawFlash3D();
        if(G.particles && G.particles.length > 0) drawParticles3D();
        if(G.path && G.path.length > 1) drawBeam3D();
        buildOnBoardButtons3D();
        drawOnBoardButtons3D();
        drawStatus();
        if(!G.modal && !G.layoutPanel){
          buildActionButtons();
          layoutButtons();
          for(var i=0;i<BUTTONS.length;i++) drawButton(BUTTONS[i]);
        }
        if(G.layoutPanel) drawLayoutPanel();
        if(G.modal) drawModal();
      } catch(e) {
        console.error("3D渲染错误:", e);
      }
    }

    function drawBackground3D(){
      var g = ctx.createLinearGradient(0, 0, 0, SH);
      g.addColorStop(0, "#0d1224");
      g.addColorStop(0.5, "#11172e");
      g.addColorStop(1, "#0a0e1a");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, SW, SH);
    }

    function drawTopBar(){
      var turnTxt = G.over ? "对局结束" : (G.current===0 ? "红方回合" : "蓝方回合");
      var col = G.over ? "#9aa3bd" : ownerColor(G.current, true);
      ctx.fillStyle = "#e8ecf5";
      ctx.font = "700 17px sans-serif";
      ctx.textAlign = "left"; ctx.textBaseline = "middle";
      ctx.fillText("\u26A1 激光镭射象棋", 12, SAFE_TOP + TOPBAR_H/2);
      var tw = ctx.measureText(turnTxt).width;
      var pw = tw + 24, ph = 28;
      var px = SW - pw - 12, py = SAFE_TOP + (TOPBAR_H - ph)/2;
      ctx.fillStyle = "#1a2138";
      roundRect(px, py, pw, ph, 14); ctx.fill();
      ctx.strokeStyle = col; ctx.lineWidth = 1.5; ctx.stroke();
      ctx.fillStyle = col;
      ctx.font = "700 13px sans-serif";
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText(turnTxt, px + pw/2, py + ph/2 + 1);
    }

    function drawStatus(){
      var y = SH - SAFE_BOT - btnAreaH - STATUS_H + 4;
      ctx.fillStyle = "#9aa3bd";
      ctx.font = "13px sans-serif";
      ctx.textAlign = "center"; ctx.textBaseline = "top";
      var txt = "";
      if(G.over) txt = "对局结束 — 点击再来一局";
      else if(G.busy) txt = "电脑思考中…";
      else if(G.phase==="select") txt = (G.mode==="pve" && G.current===G.aiPlayer) ? "" : "选择己方棋子，或直接发射 · 双指旋转视角";
      else if(G.phase==="move") txt = "点击高亮格移动 · 点旋转按钮旋转 · 双指拖动旋转视角";
      else if(G.phase==="fire") txt = "准备发射激光 · 双指可旋转视角";
      ctx.fillText(txt, SW/2, y);
    }

    /* -------------------- 按钮构建 -------------------- */
    function buildActionButtons(){
      if(G.over || G.busy) return;
      if(G.phase === "move"){
        addBtn("取消", function(){ G.phase="select"; G.sel=-1; render(); });
        addBtn("重置视角", resetView, "ghost");
      }
      else if(G.phase === "fire"){
        addBtn("\u26A1 发射", fireLaser, "primary");
        addBtn("跳过", skipFire);
        addBtn("撤销", undoAction);
        if(G.drawOffer) addBtn("平局", declareDraw);
      }
      else if(G.phase === "select" && !G.busy){
        if(!(G.mode==="pve" && G.current===G.aiPlayer)){
          addBtn("\u26A1 直接发射", directFire, "primary");
        }
        addBtn("阵型选择", function(){ G.layoutPanel = true; render(); }, "ghost");
        addBtn("难度：" + DIFFICULTY_LABEL[G.difficulty], cycleDifficulty, "ghost");
        addBtn("重开", startGame, "danger");
        addBtn("重置视角", resetView, "ghost");
      }
    }

    /* -------------------- 阵型选择面板 -------------------- */
    function drawLayoutPanel(){
      ctx.fillStyle = "rgba(6,9,20,0.85)";
      ctx.fillRect(0, 0, SW, SH);
      var pw = Math.min(SW - 40, 340);
      var ph = 440;
      var px = (SW - pw) / 2;
      var py = (SH - ph) / 2;
      ctx.fillStyle = "#1a2138";
      roundRect(px, py, pw, ph, 16); ctx.fill();
      ctx.strokeStyle = "#2e3a5e"; ctx.lineWidth = 1; ctx.stroke();
      ctx.fillStyle = "#e8ecf5";
      ctx.font = "700 18px sans-serif";
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText("选择阵型", px + pw/2, py + 30);
      BUTTONS = [];
      for(var i=0; i<LAYOUTS.length; i++){
        var L = LAYOUTS[i];
        var by = py + 60 + i * 62;
        var bw = pw - 40;
        var bx = px + 20;
        BUTTONS.push({
          x:bx, y:by, w:bw, h:54,
          label: L.name + " (" + L.en + ")",
          fn: (function(idx){ return function(){ G.layoutIdx = idx; G.layoutPanel = false; startGame(); }; })(i),
          style: i === G.layoutIdx ? "primary" : ""
        });
      }
      BUTTONS.push({
        x: px + 20, y: py + ph - 56, w: pw - 40, h: BTN_H,
        label: "关闭", fn: function(){ G.layoutPanel = false; render(); }, style: "ghost"
      });
      for(var j=0;j<BUTTONS.length;j++) drawButton(BUTTONS[j]);
      if(G.layoutIdx < LAYOUTS.length){
        ctx.fillStyle = "#9aa3bd";
        ctx.font = "12px sans-serif";
        ctx.textAlign = "center";
        ctx.fillText(LAYOUTS[G.layoutIdx].desc, px + pw/2, py + ph - 66);
      }
    }

    /* -------------------- 移动目标 -------------------- */
    function moveTargets(p){
      var ts = [];
      if(p.type === LASER) return ts;
      for(var i=0;i<DIRS8.length;i++){
        var d = DIRS8[i];
        var nr = p.row + d[0], nc = p.col + d[1];
        if(nr<0 || nr>=ROWS || nc<0 || nc>=COLS) continue;
        if(!isZoneAllowed(nr, nc, p.owner)) continue; // 区域限制
        var t = pieceAt(G.pieces, nr, nc);
        if(!t) ts.push({r:nr, c:nc, swap:false});
        else if(p.type===SWITCH && (t.type===SHIELD || t.type===MIRROR)){
          if(isZoneAllowed(p.row, p.col, t.owner)) ts.push({r:nr, c:nc, swap:true}); // 被换棋子也不能进入禁区
        }
      }
      return ts;
    }

    /* -------------------- 动作执行 -------------------- */
    function enterMove(){ G.phase = "move"; render(); }
    function doRotate(d){
      var p = G.sel >= 0 ? G.pieces[G.sel] : null;
      if(!p) return;
      p.orientation = (p.orientation + d) % 4;
      G.phase = "fire"; render();
    }
    function doLaserToggle(){
      var p = G.sel >= 0 ? G.pieces[G.sel] : null;
      if(!p) return;
      var dirs = LASER_DIRS[p.owner];
      p.orientation = p.orientation === dirs[0] ? dirs[1] : dirs[0];
      G.phase = "fire"; render();
    }
    function skipFire(){
      G.path = null; G.eliminated = null; G.undoSnapshot = null;
      endTurn();
    }
    function directFire(){
      G.undoSnapshot = G.pieces.map(function(pp){ return Object.assign({}, pp); });
      G.phase = "fire";
      fireLaser();
    }
    function undoAction(){
      if(G.undoSnapshot){
        G.pieces = G.undoSnapshot;
        G.undoSnapshot = null;
      }
      G.phase = "select"; G.sel = -1; render();
    }

    /* -------------------- 视角重置 -------------------- */
    function resetView(){
      camAnim = { fy:cam.yaw, fp:cam.pitch, ty:DEFAULT_YAW, tp:DEFAULT_PITCH, t:0, dur:0.5 };
    }

    /* -------------------- 发射激光 -------------------- */
    function fireLaser(){
      if(G.phase !== "fire") return;
      var laser = getLaser(G.pieces, G.current);
      if(!laser){ endTurn(); return; }
      var sim;
      try { sim = simulateLaser(G.pieces, laser); }
      catch(e) { sim = { path:[{r:laser.row, c:laser.col}], eliminated:null }; }
      G.path = sim.path; G.eliminated = sim.eliminated; G.phase = "anim"; G.animT = 0; G.busy = true;
      render();
      var start = Date.now(), dur = Math.max(300, (G.path.length - 1) * 120);
      function step(){
        G.animT = Math.min(1, (Date.now() - start) / dur);
        try { render(); } catch(e) {}
        if(G.animT < 1) _setTrackTimeout(step, 16);
        else finishFire();
      }
      _setTrackTimeout(step, 16);
    }

    var _kingKilled = -1;
    function finishFire(){
      _kingKilled = -1;
      if(G.eliminated){
        G.eliminated.alive = false;
        if(G.eliminated.type === KING) _kingKilled = G.eliminated.owner;
        G.flashPiece = G.eliminated;
        G.flashN = 6;
        spawnExplosion3D(G.eliminated);
        flashLoop();
      } else { afterFire(); }
    }
    function flashLoop(){
      try { render(); } catch(e) {}
      G.flashN--;
      if(G.flashN > 0 || (G.particles && G.particles.length > 0)){
        _setTrackTimeout(flashLoop, 50);
      } else {
        G.flashPiece = null;
        afterFire();
      }
    }
    function afterFire(){
      if(_kingKilled >= 0){
        G.winner = 1 - _kingKilled;
        G.over = true; G.busy = false; G.phase = "over";
        _setTrackTimeout(function(){ G.modal = "win"; render(); }, 420);
        return;
      }
      recordState();
      _setTrackTimeout(function(){ G.path = null; endTurn(); }, 480);
    }
    function endTurn(){
      G.current = 1 - G.current; G.sel = -1; G.phase = "select"; G.busy = false; G.undoSnapshot = null;
      render();
      if(G.mode === "pve" && G.current === G.aiPlayer && !G.over) _setTrackTimeout(aiTurn, 360);
    }

    /* -------------------- AI 回合 -------------------- */
    function aiTurn(){
      if(G.over) return;
      G.busy = true; render();
      _setTrackTimeout(function(){
        var act;
        try { act = aiChoose(G.pieces, G.aiPlayer, G.difficulty); }
        catch(e) { G.busy = false; endTurn(); return; }
        G.busy = false;
        applyAiAction(act);
      }, 420);
    }
    function applyAiAction(act){
      if(act.kind === "skip"){
        G.busy = false; G.sel = -1;
        try { render(); } catch(e) {}
        _setTrackTimeout(function(){ G.undoSnapshot = null; endTurn(); }, 520);
        return;
      }
      var p = G.pieces[act.pi];
      if(!p){ G.busy = false; endTurn(); return; }
      G.sel = act.pi;
      if(act.kind === "rot") p.orientation = (p.orientation + act.d) % 4;
      else if(act.kind === "laserRot") p.orientation = act.dir;
      else if(act.kind === "move"){ p.row = act.r; p.col = act.c; }
      else if(act.kind === "swap"){ var t = G.pieces[act.ti]; if(!t){ G.busy=false; endTurn(); return; } var tr=t.row,tc=t.col; t.row=p.row;t.col=p.col; p.row=tr;p.col=tc; }
      try { render(); } catch(e) {}
      G.phase = "fire";
      _setTrackTimeout(function(){ fireLaser(); }, 520);
    }

    /* -------------------- 平局 -------------------- */
    function declareDraw(){
      G.over = true; G.winner = -1; G.phase = "over";
      G.modal = "draw"; render();
    }

    /* -------------------- 弹窗 -------------------- */
    function drawModal(){
      ctx.fillStyle = "rgba(6,9,20,0.82)";
      ctx.fillRect(0, 0, SW, SH);
      var pw = Math.min(SW - 60, 320);
      var ph = 210;
      var px = (SW - pw) / 2;
      var py = (SH - ph) / 2;
      ctx.fillStyle = "#1a2138";
      roundRect(px, py, pw, ph, 16); ctx.fill();
      ctx.strokeStyle = "#2e3a5e"; ctx.lineWidth = 1; ctx.stroke();
      var title = "", sub = "";
      if(G.modal === "win"){
        title = (G.winner === 0 ? "红方" : "蓝方") + "获胜";
        sub = "激光命中对方国王，游戏结束。";
      } else if(G.modal === "draw"){
        title = "平局";
        sub = "相同局面出现三次，本局以平局结束。";
      } else return;
      ctx.fillStyle = "#e8ecf5";
      ctx.font = "700 22px sans-serif";
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText(title, px + pw/2, py + 55);
      ctx.fillStyle = "#9aa3bd";
      ctx.font = "14px sans-serif";
      var lines = sub.split("\n");
      for(var i=0;i<lines.length;i++) ctx.fillText(lines[i], px + pw/2, py + 95 + i*22);
      BUTTONS = [];
      BUTTONS.push({
        x: px + 40, y: py + ph - 56, w: pw - 80, h: BTN_H,
        label: "再来一局",
        fn: function(){ G.modal = null; startGame(); },
        style: "primary"
      });
      for(var j=0;j<BUTTONS.length;j++) drawButton(BUTTONS[j]);
    }

    /* -------------------- 触摸：单指点击/拖动 + 双指旋转 -------------------- */
    // 单指轻点 = 点击棋子/按钮
    // 单指拖动（超过阈值）= 旋转视角（yaw/pitch）
    // 双指 = 旋转视角（yaw/pitch + 缩放）
    var touchMode = "none"; // "none" | "click" | "camera" | "drag"
    var clickStart = { x:0, y:0 };
    var camGesture = { lastDist:0, lastMidY:0 };
    var lastDrag = { x:0, y:0 };
    var DRAG_THRESHOLD = 15; // 单指移动超过此距离判定为拖动视角

    function screenToCell(sx, sy){
      var bestR = -1, bestC = -1, bestDist = Infinity, bestS = 1;
      for(var r=0;r<ROWS;r++){
        for(var c=0;c<COLS;c++){
          var wx = c - (COLS-1)/2;
          var wz = r - (ROWS-1)/2;
          var p = project3D(wx, 0, wz);
          var dx = sx-p.x, dy = sy-p.y;
          var d = dx*dx+dy*dy;
          if(d < bestDist){ bestDist = d; bestR = r; bestC = c; bestS = p.s; }
        }
      }
      if(Math.sqrt(bestDist) < Math.max(bestS * 0.85, 22)) return { r: bestR, c: bestC };
      return null;
    }

    function _getTouches(e){
      if(!e) return [];
      if(e.touches && e.touches.length) return e.touches;
      if(e.changedTouches && e.changedTouches.length) return e.changedTouches;
      return [];
    }

    function handleTouchStart(e){
      try {
        var ts = _getTouches(e);
        if(ts.length >= 2){
          touchMode = "camera";
          var t1 = ts[0], t2 = ts[1];
          camGesture.lastDist = Math.sqrt((t1.clientX-t2.clientX)*(t1.clientX-t2.clientX)+(t1.clientY-t2.clientY)*(t1.clientY-t2.clientY));
          camGesture.lastMidY = (t1.clientY+t2.clientY)/2;
        } else if(ts.length === 1){
          touchMode = "click";
          clickStart.x = ts[0].clientX;
          clickStart.y = ts[0].clientY;
          lastDrag.x = ts[0].clientX;
          lastDrag.y = ts[0].clientY;
        }
      } catch(err) {}
    }

    function handleTouchMove(e){
      try {
        var ts = _getTouches(e);
        if(touchMode === "camera" && ts.length >= 2){
          var t1 = ts[0], t2 = ts[1];
          var dist = Math.sqrt((t1.clientX-t2.clientX)*(t1.clientX-t2.clientX)+(t1.clientY-t2.clientY)*(t1.clientY-t2.clientY));
          var midY = (t1.clientY+t2.clientY)/2;
          // 双指捏合 → pitch（缩放视野角度）
          var dDist = dist - camGesture.lastDist;
          cam.pitch += dDist * 0.004;
          // 双指上下平移 → pitch
          cam.pitch -= (midY - camGesture.lastMidY) * 0.004;
          // 双指左右旋转 → yaw（用两指连线角度变化）
          var angle = Math.atan2(t2.clientY-t1.clientY, t2.clientX-t1.clientX);
          if(camGesture.lastAngle !== undefined){
            var dA = angle - camGesture.lastAngle;
            // 处理角度跨越π的情况
            if(dA > Math.PI) dA -= 2*Math.PI;
            if(dA < -Math.PI) dA += 2*Math.PI;
            cam.yaw += dA * 1.2;
          }
          camGesture.lastAngle = angle;
          cam.pitch = Math.max(0.2, Math.min(1.5, cam.pitch));
          cam.yaw = Math.max(-1.6, Math.min(1.6, cam.yaw));
          camGesture.lastDist = dist;
          camGesture.lastMidY = midY;
        } else if(touchMode === "click" && ts.length === 1){
          // 单指移动：超过阈值则切换为拖动模式
          var dx = ts[0].clientX - lastDrag.x;
          var dy = ts[0].clientY - lastDrag.y;
          var moveDist = Math.sqrt(dx*dx + dy*dy);
          if(moveDist > DRAG_THRESHOLD){
            touchMode = "drag";
          }
        } else if(touchMode === "drag" && ts.length === 1){
          // 单指拖动：旋转相机
          var ddx = ts[0].clientX - lastDrag.x;
          var ddy = ts[0].clientY - lastDrag.y;
          cam.yaw += ddx * 0.006;
          cam.pitch -= ddy * 0.005;
          cam.pitch = Math.max(0.2, Math.min(1.5, cam.pitch));
          cam.yaw = Math.max(-1.6, Math.min(1.6, cam.yaw));
          lastDrag.x = ts[0].clientX;
          lastDrag.y = ts[0].clientY;
        }
      } catch(err) {}
    }

    function handleTouchEnd(e){
      try {
        // 关键修复：直接检查 e.touches（当前屏幕上的活跃触摸点数量）
        var activeCount = (e && e.touches && e.touches.length) ? e.touches.length : 0;
        if(activeCount === 0 && (touchMode === "click" || touchMode === "drag")){
          // 所有手指已抬起
          var wasDrag = (touchMode === "drag");
          touchMode = "none";
          if(wasDrag) return; // 拖动结束，不处理点击
          var changed = (e && e.changedTouches) ? e.changedTouches : [];
          if(!changed.length) return;
          var t = changed[0];
          var x = t.clientX, y = t.clientY;
          if(x === undefined || y === undefined) return;
          var move = Math.sqrt((x-clickStart.x)*(x-clickStart.x)+(y-clickStart.y)*(y-clickStart.y));
          if(move > 40) return;
          processClick(x, y);
        } else if(activeCount < 2){
          if(activeCount === 1){
            touchMode = "click";
            clickStart.x = e.touches[0].clientX;
            clickStart.y = e.touches[0].clientY;
            lastDrag.x = e.touches[0].clientX;
            lastDrag.y = e.touches[0].clientY;
            camGesture.lastAngle = undefined;
          } else {
            touchMode = "none";
          }
        }
      } catch(err) { console.error("touchEnd error:", err); }
    }

    // 外部相机控制（供调试页面鼠标右键拖动使用）
    function externalCameraControl(dx, dy){
      cam.yaw += dx * 0.006;
      cam.pitch -= dy * 0.005;
      cam.pitch = Math.max(0.2, Math.min(1.5, cam.pitch));
      cam.yaw = Math.max(-1.6, Math.min(1.6, cam.yaw));
    }

    function processClick(x, y){
      if(G.layoutPanel){ var b1 = hitButton(x,y); if(b1&&b1.fn) b1.fn(); return; }
      if(G.modal){ var b2 = hitButton(x,y); if(b2&&b2.fn) b2.fn(); return; }
      if(G.over || G.busy){ var b3 = hitButton(x,y); if(b3&&b3.fn) b3.fn(); return; }
      if(G.mode === "pve" && G.current === G.aiPlayer) return;

      var btn = hitButton(x, y);
      if(btn && btn.fn){ btn.fn(); return; }

      var ob = hitOnBoard3D(x, y);
      if(ob && ob.fn){ ob.fn(); return; }

      var cell = screenToCell(x, y);
      if(!cell) return;
      var r = cell.r, c = cell.c;

      if(G.phase === "select"){
        var p = pieceAt(G.pieces, r, c);
        if(p && p.owner === G.current){
          G.undoSnapshot = G.pieces.map(function(pp){ return Object.assign({}, pp); });
          G.sel = G.pieces.indexOf(p);
          G.phase = "move";
          render();
        }
      }
      else if(G.phase === "move"){
        var selP = G.pieces[G.sel];
        if(!selP){ G.phase = "select"; render(); return; }
        var tg = null;
        var targets = moveTargets(selP);
        for(var i=0;i<targets.length;i++){
          if(targets[i].r===r && targets[i].c===c){ tg = targets[i]; break; }
        }
        if(tg){
          if(tg.swap){ var tp = pieceAt(G.pieces, r, c); var tr2=tp.row,tc2=tp.col; tp.row=selP.row;tp.col=selP.col; selP.row=tr2;selP.col=tc2; }
          else { selP.row = r; selP.col = c; }
          G.phase = "fire"; render();
        } else {
          var np = pieceAt(G.pieces, r, c);
          if(np && np.owner === G.current && np !== selP){
            G.sel = G.pieces.indexOf(np);
            render();
          } else if(!np){ G.phase = "select"; G.sel = -1; render(); }
        }
      }
    }

    /* -------------------- 启动 -------------------- */
    startGame();

    /* -------------------- 模块接口 -------------------- */
    return {
      update: function(dt){
        if(camAnim){
          camAnim.t += dt / camAnim.dur;
          if(camAnim.t >= 1){
            cam.yaw = camAnim.ty;
            cam.pitch = camAnim.tp;
            camAnim = null;
          } else {
            var e = easeInOut(camAnim.t);
            cam.yaw = camAnim.fy + (camAnim.ty - camAnim.fy) * e;
            cam.pitch = camAnim.fp + (camAnim.tp - camAnim.fp) * e;
          }
        }
        updateParticles(dt);
      },
      render: function(){ render(); },
      onTouchStart: function(e){ handleTouchStart(e); },
      onTouchMove: function(e){ handleTouchMove(e); },
      onTouchEnd: function(e){ handleTouchEnd(e); },
      cameraControl: function(dx, dy){ externalCameraControl(dx, dy); },
      _debugAI: {
        choose: function(pieces, player, level){ return aiChoose(pieces, player, level); },
        actions: function(pieces, player){ return generateActions(pieces, player); },
        resolve: function(pieces, player, action){ return resolveTurn(pieces, player, action); },
        initialPieces: function(layoutIndex){ return makeInitialPieces(layoutIndex); },
        getDifficulty: function(){ return G.difficulty; },
        cycleDifficulty: cycleDifficulty,
        restart: startGame
      },
      exit: function(){
        for(var i=0;i<_timeouts.length;i++) clearTimeout(_timeouts[i]);
        _timeouts = [];
      }
    };
  }
};
