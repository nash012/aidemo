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
  PIECE_VALUE:{king:10000,shield:3,switch:5,mirror:4,laser:0},
  AI_LEVELS:{
    easy:{attack:2.5,defense:0.7,guard:0.8,reply:0,advance:0.7,initiative:1.2,passive:0.25,candidates:12,variety:4.0,depth:1,foresight:0.4,caution:0.25,blunder:0.15},
    normal:{attack:3.5,defense:1.3,guard:1.0,reply:0.5,advance:1.0,initiative:1.8,passive:0.3,candidates:40,variety:1.0,depth:2,foresight:0.65,caution:0.7,blunder:0},
    hard:{attack:4.5,defense:1.6,guard:1.3,reply:1.0,advance:1.3,initiative:2.5,passive:0.4,candidates:50,variety:0.2,depth:3,foresight:0.9,caution:1.0,blunder:0}
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
      easy:"神经网络AI驱动",
      normal:"神经网络AI驱动",
      hard:"神经网络AI驱动"
    }
  }
};
