"use strict";

var UP=0,RIGHT=1,DOWN=2,LEFT=3;
var LASER="laser",KING="king",SHIELD="shield",MIRROR="mirror",SWITCH="switch";
var RED_ZONE_CELLS=[[6,9],[5,9],[4,9],[3,9],[2,9],[1,9],[0,9],[7,1],[0,1]];
var BLUE_ZONE_CELLS=[[7,0],[6,0],[5,0],[4,0],[3,0],[2,0],[1,0],[7,8],[0,8]];

function zoneLookup(cells){
  var lookup={};
  cells.forEach(function(cell){ lookup[cell[0]+","+cell[1]]=true; });
  return lookup;
}

module.exports = {
  BOARD:{cols:10,rows:8},
  DIRECTION:{UP:UP,RIGHT:RIGHT,DOWN:DOWN,LEFT:LEFT},
  DX:[0,1,0,-1],
  DY:[-1,0,1,0],
  DIRS8:[[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]],
  PIECE:{LASER:LASER,KING:KING,SHIELD:SHIELD,MIRROR:MIRROR,SWITCH:SWITCH},
  PIECE_VALUE:{king:10000,shield:3,switch:4,mirror:2,laser:0},
  AI_LEVELS:{
    easy:{attack:1.05,defense:1.10,guard:1.15,reply:0,advance:0.55,initiative:1.10,passive:0.24,candidates:24,variety:3.0,depth:1},
    normal:{attack:2.35,defense:1.00,guard:0.90,reply:0.65,advance:0.90,initiative:1.60,passive:0.32,candidates:40,variety:1.0,depth:2},
    hard:{attack:2.15,defense:1.20,guard:1.10,reply:1.0,advance:1.10,initiative:2.00,passive:0.38,candidates:40,variety:0.25,depth:3}
  },
  MIRROR_MAP:[{1:0,2:3},{3:0,2:1},{3:2,0:1},{1:2,0:3}],
  SWITCH_SLASH:{1:0,0:1,3:2,2:3},
  SWITCH_BACK:{1:2,2:1,3:0,0:3},
  LASER_DIRECTIONS:{0:[LEFT,UP],1:[RIGHT,DOWN]},
  ZONES:{
    red:RED_ZONE_CELLS,
    blue:BLUE_ZONE_CELLS
  },
  ZONE_LOOKUP:{red:zoneLookup(RED_ZONE_CELLS),blue:zoneLookup(BLUE_ZONE_CELLS)},
  DIFFICULTY:{
    order:["easy","normal","hard"],
    labels:{easy:"简单",normal:"普通",hard:"困难"},
    descriptions:{
      easy:"主动推进并尝试简单攻击，仍会保留容错空间",
      normal:"主动构建反射路线，并预判玩家下一步回应",
      hard:"持续施压并推演多回合，优先形成致命光路"
    }
  }
};
