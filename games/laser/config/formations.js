"use strict";

var C=require("./constants.js");
var D=C.DIRECTION,P=C.PIECE;
var UP=D.UP,RIGHT=D.RIGHT,DOWN=D.DOWN,LEFT=D.LEFT;
var LASER=P.LASER,KING=P.KING,SHIELD=P.SHIELD,MIRROR=P.MIRROR,SWITCH=P.SWITCH;

var FORMATIONS = [
  {name:"幺点",en:"ACE",desc:"入门阵型，简单均衡",
   p0:[[LASER,7,9,UP],[SHIELD,7,5,UP],[KING,7,4,UP],[SHIELD,7,3,UP],
       [MIRROR,7,2,UP],[MIRROR,6,7,RIGHT],[MIRROR,4,9,LEFT],
       [SWITCH,4,5,RIGHT],[SWITCH,4,4,DOWN],[MIRROR,4,2,UP],
       [MIRROR,3,9,UP],[MIRROR,3,2,LEFT],[MIRROR,2,3,UP]],
   p1:[[MIRROR,5,6,DOWN],[MIRROR,4,7,RIGHT],[MIRROR,4,0,DOWN],
       [MIRROR,3,7,DOWN],[SWITCH,3,5,DOWN],[SWITCH,3,4,RIGHT],
       [MIRROR,3,0,RIGHT],[MIRROR,1,2,LEFT],[MIRROR,0,7,DOWN],
       [SHIELD,0,6,DOWN],[KING,0,5,DOWN],[SHIELD,0,4,DOWN],[LASER,0,0,DOWN]]},
  {name:"好奇",en:"CURIOSITY",desc:"镜面前推，开局更具进攻性",
   p0:[[LASER,7,9,UP],[SHIELD,7,5,UP],[KING,7,4,UP],[SHIELD,7,3,UP],
       [SWITCH,7,2,DOWN],[MIRROR,5,3,LEFT],[MIRROR,4,9,LEFT],
       [SWITCH,4,4,DOWN],[MIRROR,4,1,UP],[MIRROR,3,9,UP],
       [MIRROR,3,4,DOWN],[MIRROR,3,1,LEFT],[MIRROR,2,3,UP]],
   p1:[[MIRROR,5,6,DOWN],[MIRROR,4,8,RIGHT],[MIRROR,4,5,UP],
       [MIRROR,4,0,DOWN],[MIRROR,3,8,DOWN],[SWITCH,3,5,DOWN],
       [MIRROR,3,0,RIGHT],[MIRROR,2,6,RIGHT],[SWITCH,0,7,DOWN],
       [SHIELD,0,6,DOWN],[KING,0,5,DOWN],[SHIELD,0,4,DOWN],[LASER,0,0,DOWN]]},
  {name:"圣杯",en:"GRAIL",desc:"国王重兵把守，防御坚固",
   p0:[[LASER,7,9,UP],[MIRROR,7,5,RIGHT],[SHIELD,7,4,UP],[MIRROR,7,3,UP],
       [KING,6,4,UP],[MIRROR,5,9,LEFT],[MIRROR,5,5,RIGHT],
       [SHIELD,5,4,UP],[SWITCH,5,3,DOWN],[MIRROR,4,9,UP],
       [SWITCH,4,7,RIGHT],[MIRROR,3,6,DOWN],[MIRROR,3,4,UP]],
   p1:[[MIRROR,4,5,DOWN],[MIRROR,4,3,UP],[SWITCH,3,2,RIGHT],
       [MIRROR,3,0,DOWN],[SWITCH,2,6,DOWN],[SHIELD,2,5,DOWN],
       [MIRROR,2,4,LEFT],[MIRROR,2,0,RIGHT],[KING,1,5,DOWN],
       [MIRROR,0,6,DOWN],[SHIELD,0,5,DOWN],[MIRROR,0,4,LEFT],[LASER,0,0,DOWN]]},
  {name:"水星",en:"MERCURY",desc:"镜链复杂，反射路径多变",
   p0:[[LASER,7,9,UP],[MIRROR,7,5,RIGHT],[KING,7,4,UP],[MIRROR,7,3,UP],
       [SHIELD,6,4,UP],[MIRROR,6,3,UP],[MIRROR,5,9,UP],
       [SWITCH,5,6,DOWN],[SHIELD,5,4,UP],[MIRROR,4,9,LEFT],
       [MIRROR,3,8,LEFT],[MIRROR,3,4,UP],[SWITCH,0,9,DOWN]],
   p1:[[SWITCH,7,0,DOWN],[MIRROR,4,5,DOWN],[MIRROR,4,1,RIGHT],
       [MIRROR,3,0,RIGHT],[SHIELD,2,5,DOWN],[SWITCH,2,3,DOWN],
       [MIRROR,2,0,DOWN],[MIRROR,1,6,DOWN],[SHIELD,1,5,DOWN],
       [MIRROR,0,6,DOWN],[KING,0,5,DOWN],[MIRROR,0,4,LEFT],[LASER,0,0,DOWN]]},
  {name:"苏菲",en:"SOPHIE",desc:"棋子分散全盘，高阶对弈",
   p0:[[LASER,7,9,UP],[KING,7,5,UP],[MIRROR,7,3,UP],
       [SHIELD,6,6,UP],[SHIELD,6,4,UP],[MIRROR,5,9,LEFT],
       [MIRROR,5,5,RIGHT],[MIRROR,5,4,UP],[SWITCH,4,2,RIGHT],
       [MIRROR,2,9,UP],[SWITCH,2,7,DOWN],[MIRROR,1,9,LEFT],[MIRROR,0,5,UP]],
   p1:[[MIRROR,7,4,DOWN],[MIRROR,6,0,RIGHT],[SWITCH,5,2,DOWN],
       [MIRROR,5,0,DOWN],[SWITCH,3,7,RIGHT],[MIRROR,2,5,DOWN],
       [MIRROR,2,4,LEFT],[MIRROR,2,0,RIGHT],[SHIELD,1,5,DOWN],
       [SHIELD,1,3,DOWN],[MIRROR,0,6,DOWN],[KING,0,4,DOWN],[LASER,0,0,DOWN]]}
];

function makeInitialPieces(layoutIndex){
  layoutIndex=layoutIndex||0;
  var layout=FORMATIONS[layoutIndex],pieces=[];
  layout.p0.forEach(function(d,index){
    pieces.push({id:"r"+index,type:d[0],owner:0,row:d[1],col:d[2],orientation:d[3],alive:true});
  });
  layout.p1.forEach(function(d,index){
    pieces.push({id:"b"+index,type:d[0],owner:1,row:d[1],col:d[2],orientation:d[3],alive:true});
  });
  return pieces;
}

module.exports={FORMATIONS:FORMATIONS,makeInitialPieces:makeInitialPieces};
