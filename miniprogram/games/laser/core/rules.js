"use strict";

var C=require("../config/constants.js");
var BOARD=C.BOARD,D=C.DIRECTION,P=C.PIECE;
var COLS=BOARD.cols,ROWS=BOARD.rows;
var UP=D.UP,RIGHT=D.RIGHT,DOWN=D.DOWN,LEFT=D.LEFT;
var DX=C.DX,DY=C.DY,DIRS8=C.DIRS8;
var LASER=P.LASER,KING=P.KING,SHIELD=P.SHIELD,MIRROR=P.MIRROR,SWITCH=P.SWITCH;
var MIRROR_MAP=C.MIRROR_MAP,SW_SLASH=C.SWITCH_SLASH,SW_BACK=C.SWITCH_BACK;
var LASER_DIRS=C.LASER_DIRECTIONS;

var RED_ZONES=C.ZONE_LOOKUP.red;
var BLUE_ZONES=C.ZONE_LOOKUP.blue;

function isZoneAllowed(row,col,owner){
  var key=row+","+col;
  if(owner===0 && BLUE_ZONES[key]) return false;
  if(owner===1 && RED_ZONES[key]) return false;
  return true;
}

function laserHit(piece,inDir){
  try {
    var orientation=piece.orientation,type=piece.type;
    if(orientation===undefined || orientation===null || orientation<0 || orientation>3) return "block";
    if(inDir===undefined || inDir===null || inDir<0 || inDir>3) return "block";
    if(type===KING) return "eliminate";
    if(type===LASER) return "block";
    if(type===SHIELD) return inDir===((orientation+2)%4) ? "block" : "eliminate";
    if(type===MIRROR){
      var reflected=MIRROR_MAP[orientation] ? MIRROR_MAP[orientation][inDir] : undefined;
      return reflected!==undefined ? reflected : "eliminate";
    }
    if(type===SWITCH){
      var table=(orientation%2===0) ? SW_SLASH : SW_BACK;
      var switched=table[inDir];
      return switched!==undefined ? switched : "block";
    }
    return "block";
  } catch(error){
    return "block";
  }
}

function pieceAt(pieces,row,col){
  for(var i=0;i<pieces.length;i++){
    if(pieces[i].alive && pieces[i].row===row && pieces[i].col===col) return pieces[i];
  }
  return null;
}

function getLaser(pieces,player){
  for(var i=0;i<pieces.length;i++){
    if(pieces[i].alive && pieces[i].owner===player && pieces[i].type===LASER) return pieces[i];
  }
  return null;
}

function simulateLaser(pieces,laser){
  var dir=laser.orientation;
  var row=laser.row+DY[dir],col=laser.col+DX[dir];
  var path=[{r:laser.row,c:laser.col}],eliminated=null,seen={},steps=0;
  while(row>=0 && row<ROWS && col>=0 && col<COLS && steps<200){
    steps++;
    var key=row+","+col+","+dir;
    if(seen[key]) break;
    seen[key]=true;
    var piece=pieceAt(pieces,row,col);
    path.push({r:row,c:col});
    if(piece){
      var result=laserHit(piece,dir);
      if(result==="eliminate"){ eliminated=piece; break; }
      if(result==="block") break;
      if(typeof result==="number") dir=result;
      else break;
    }
    row+=DY[dir];
    col+=DX[dir];
  }
  return {path:path,eliminated:eliminated};
}

function generateActions(pieces,player,options){
  options=options||{};
  var actions=[];
  for(var i=0;i<pieces.length;i++){
    var piece=pieces[i];
    if(piece.owner!==player || !piece.alive) continue;
    if(piece.type===LASER){
      var dirs=LASER_DIRS[player];
      var newDir=piece.orientation===dirs[0] ? dirs[1] : dirs[0];
      actions.push({pi:i,kind:"laserRot",dir:newDir});
      continue;
    }
    for(var j=0;j<DIRS8.length;j++){
      var delta=DIRS8[j],nextRow=piece.row+delta[0],nextCol=piece.col+delta[1];
      if(nextRow<0 || nextRow>=ROWS || nextCol<0 || nextCol>=COLS) continue;
      if(!isZoneAllowed(nextRow,nextCol,piece.owner)) continue;
      if(!pieceAt(pieces,nextRow,nextCol)) actions.push({pi:i,kind:"move",r:nextRow,c:nextCol});
    }
    actions.push({pi:i,kind:"rot",d:1});
    actions.push({pi:i,kind:"rot",d:3});
    if(piece.type===SWITCH && !options.noSwap){
      for(var k=0;k<DIRS8.length;k++){
        var swapDelta=DIRS8[k],swapRow=piece.row+swapDelta[0],swapCol=piece.col+swapDelta[1];
        if(swapRow<0 || swapRow>=ROWS || swapCol<0 || swapCol>=COLS) continue;
        var target=pieceAt(pieces,swapRow,swapCol);
        if(target && (target.type===SHIELD || target.type===MIRROR) &&
           isZoneAllowed(swapRow,swapCol,piece.owner) && isZoneAllowed(piece.row,piece.col,target.owner)){
          actions.push({pi:i,kind:"swap",ti:pieces.indexOf(target)});
        }
      }
    }
  }
  return actions;
}

function applyAction(pieces,action){
  if(action.kind==="skip") return pieces.map(function(piece){ return Object.assign({},piece); });
  var next=pieces.map(function(piece){ return Object.assign({},piece); });
  var moving=next[action.pi];
  if(action.kind==="rot") moving.orientation=(moving.orientation+action.d)%4;
  else if(action.kind==="laserRot") moving.orientation=action.dir;
  else if(action.kind==="move"){ moving.row=action.r; moving.col=action.c; }
  else if(action.kind==="swap"){
    var target=next[action.ti],row=target.row,col=target.col;
    target.row=moving.row; target.col=moving.col;
    moving.row=row; moving.col=col;
  }
  return next;
}

function resolveTurn(pieces,player,action){
  var after=applyAction(pieces,action);
  var laser=getLaser(after,player),path=[],eliminated=null;
  if(laser){
    var simulation=simulateLaser(after,laser);
    path=simulation.path;
    eliminated=simulation.eliminated;
    if(eliminated) eliminated.alive=false;
  }
  return {np:after,path:path,eliminated:eliminated};
}

module.exports={
  isZoneAllowed:isZoneAllowed,
  laserHit:laserHit,
  pieceAt:pieceAt,
  getLaser:getLaser,
  simulateLaser:simulateLaser,
  generateActions:generateActions,
  applyAction:applyAction,
  resolveTurn:resolveTurn
};
