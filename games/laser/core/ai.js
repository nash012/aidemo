"use strict";

var C=require("../config/constants.js");
var Rules=require("./rules.js");
var BOARD=C.BOARD,D=C.DIRECTION,P=C.PIECE;
var ROWS=BOARD.rows;
var UP=D.UP,RIGHT=D.RIGHT,DOWN=D.DOWN,LEFT=D.LEFT;
var KING=P.KING,LASER=P.LASER,MIRROR=P.MIRROR,SWITCH=P.SWITCH;
var PIECE_VALUE=C.PIECE_VALUE,AI_LEVELS=C.AI_LEVELS;
var AB_CHILD_LIMIT=30;

function allActions(pieces,player){
  var actions=Rules.generateActions(pieces,player);
  actions.push({kind:"skip"});
  return actions;
}

function findKing(pieces,player){
  for(var i=0;i<pieces.length;i++){
    var piece=pieces[i];
    if(piece.alive && piece.owner===player && piece.type===KING) return piece;
  }
  return null;
}

function laserPressure(pieces,player){
  var laser=Rules.getLaser(pieces,player);
  var king=findKing(pieces,1-player);
  if(!laser || !king) return 0;
  var simulation=Rules.simulateLaser(pieces,laser);
  var minDistance=Infinity,turns=0,enemyHalf=0,previousDirection=-1;
  for(var i=0;i<simulation.path.length;i++){
    var point=simulation.path[i];
    var distance=Math.abs(point.r-king.row)+Math.abs(point.c-king.col);
    if(distance<minDistance) minDistance=distance;
    if((player===1 && point.r>=ROWS/2) || (player===0 && point.r<ROWS/2)) enemyHalf++;
    if(i>0){
      var previous=simulation.path[i-1];
      var direction=point.r>previous.r ? DOWN : point.r<previous.r ? UP : point.c>previous.c ? RIGHT : LEFT;
      if(previousDirection>=0 && direction!==previousDirection) turns++;
      previousDirection=direction;
    }
  }
  return Math.max(0,12-minDistance*3)+Math.min(simulation.path.length,14)*0.35+turns*2+enemyHalf*0.3;
}

function attackingPresence(pieces,player){
  var king=findKing(pieces,1-player);
  if(!king) return 30;
  var score=0;
  for(var i=0;i<pieces.length;i++){
    var piece=pieces[i];
    if(!piece.alive || piece.owner!==player || piece.type===KING || piece.type===LASER) continue;
    var distance=Math.abs(piece.row-king.row)+Math.abs(piece.col-king.col);
    var tactical=piece.type===SWITCH ? 1.2 : piece.type===MIRROR ? 1.0 : 0.7;
    score+=Math.max(0,10-distance)*0.18*tactical;
    if((player===1 && piece.row>=ROWS/2) || (player===0 && piece.row<ROWS/2)) score+=0.55*tactical;
  }
  return score;
}

function initiativeBonus(before,after,player,action,config,passiveTurns){
  var beforeThreat=laserPressure(before,player)+attackingPresence(before,player)*0.35;
  var afterThreat=laserPressure(after,player)+attackingPresence(after,player)*0.35;
  var scale=(config.initiative||0)*(1+Math.min(3,passiveTurns||0)*0.45);
  var bonus=(afterThreat-beforeThreat)*scale;
  if(action && action.kind==="skip") bonus-=scale*(1.8+Math.min(3,passiveTurns||0));
  return bonus;
}

function passiveHumanTurn(before,after,player){
  if(!Array.isArray(before) || !Array.isArray(after)) return false;
  var opponent=1-player,beforeOpponents=0,afterOpponents=0;
  for(var i=0;i<before.length;i++) if(before[i].alive && before[i].owner===opponent) beforeOpponents++;
  for(var j=0;j<after.length;j++) if(after[j].alive && after[j].owner===opponent) afterOpponents++;
  if(afterOpponents<beforeOpponents) return false;
  var beforeThreat=laserPressure(before,player)+attackingPresence(before,player)*0.35;
  var afterThreat=laserPressure(after,player)+attackingPresence(after,player)*0.35;
  return afterThreat<beforeThreat+0.75;
}

function evaluatePosition(pieces,player,difficulty,aggressionPlayer,passiveTurns){
  var config=AI_LEVELS[difficulty]||AI_LEVELS.normal;
  var opponent=1-player,score=0;
  for(var i=0;i<pieces.length;i++){
    var piece=pieces[i];
    if(!piece.alive) continue;
    var value=PIECE_VALUE[piece.type]||0;
    score+=piece.owner===player ? value : -value;
  }
  var king=findKing(pieces,player);
  var passive=Math.min(3,Math.max(0,passiveTurns||0));
  var myBoost=player===aggressionPlayer ? 1+passive*config.passive : 1;
  var opponentBoost=opponent===aggressionPlayer ? 1+passive*config.passive : 1;
  score+=laserPressure(pieces,player)*config.attack*myBoost;
  score-=laserPressure(pieces,opponent)*config.defense*opponentBoost;
  score+=attackingPresence(pieces,player)*config.advance*myBoost;
  score-=attackingPresence(pieces,opponent)*config.advance*0.55*opponentBoost;
  if(king){
    var guards=0;
    for(var j=0;j<pieces.length;j++){
      var guard=pieces[j];
      if(!guard.alive || guard.owner!==player || guard.type===KING || guard.type===LASER) continue;
      if(Math.abs(guard.row-king.row)+Math.abs(guard.col-king.col)<=2) guards++;
    }
    score+=guards*config.guard;
  }
  return score;
}

function alphaBeta(pieces,depth,alpha,beta,player,difficulty,aggressionPlayer,passiveTurns){
  var opponent=1-player;
  if(!findKing(pieces,player)) return -100000-depth;
  if(!findKing(pieces,opponent)) return 100000+depth;
  if(depth===0) return evaluatePosition(pieces,player,difficulty,aggressionPlayer,passiveTurns);

  var actions=allActions(pieces,player),scored=[];
  for(var i=0;i<actions.length;i++){
    var result=Rules.resolveTurn(pieces,player,actions[i]);
    var score,suicide=false,kingKill=false;
    if(result.eliminated && result.eliminated.type===KING){
      if(result.eliminated.owner===player){ score=-100000-depth; suicide=true; }
      else { score=100000+depth; kingKill=true; }
    } else {
      score=evaluatePosition(result.np,player,difficulty,aggressionPlayer,passiveTurns);
      if(result.eliminated){
        score+=(result.eliminated.owner===player ? -PIECE_VALUE[result.eliminated.type] : PIECE_VALUE[result.eliminated.type])*4;
      }
    }
    scored.push({res:result,s:score,suicide:suicide,kingKill:kingKill});
  }
  scored.sort(function(a,b){ return b.s-a.s; });
  var limit=Math.min(scored.length,AB_CHILD_LIMIT),best=-Infinity;
  for(var j=0;j<limit;j++){
    var candidate=scored[j];
    if(candidate.suicide) continue;
    var value=candidate.kingKill ? 100000+depth :
      -alphaBeta(candidate.res.np,depth-1,-beta,-alpha,opponent,difficulty,aggressionPlayer,passiveTurns);
    if(value>best) best=value;
    if(value>alpha) alpha=value;
    if(alpha>=beta) break;
  }
  if(best===-Infinity) best=evaluatePosition(pieces,player,difficulty,aggressionPlayer,passiveTurns);
  return best;
}

function choose(pieces,aiPlayer,difficulty,passiveTurns){
  difficulty=AI_LEVELS[difficulty] ? difficulty : "normal";
  var config=AI_LEVELS[difficulty],opponent=1-aiPlayer;
  passiveTurns=Math.min(3,Math.max(0,passiveTurns||0));

  if(difficulty==="easy"){
    var easyScored=allActions(pieces,aiPlayer).map(function(action){
      var score=0,win=false,suicide=false;
      var result=Rules.resolveTurn(pieces,aiPlayer,action);
      if(result.eliminated){
        var eliminated=result.eliminated;
        if(eliminated.type===KING){
          if(eliminated.owner===aiPlayer){ score=-100000; suicide=true; }
          else { score=100000; win=true; }
        } else {
          score+=(eliminated.owner===aiPlayer ? -PIECE_VALUE[eliminated.type] : PIECE_VALUE[eliminated.type])*4;
        }
      }
      if(!win && !suicide){
        score+=evaluatePosition(result.np,aiPlayer,difficulty,aiPlayer,passiveTurns);
        score+=initiativeBonus(pieces,result.np,aiPlayer,action,config,passiveTurns);
      }
      return {a:action,s:score,win:win,suicide:suicide};
    });
    var wins=easyScored.filter(function(item){ return item.win; });
    if(wins.length) return wins[Math.floor(Math.random()*wins.length)].a;
    var safe=easyScored.filter(function(item){ return !item.suicide; });
    var pool=safe.length ? safe : easyScored;
    pool.sort(function(a,b){ return b.s-a.s; });
    var top=pool.slice(0,config.candidates),bestScore=top[0].s;
    var equals=top.filter(function(item){ return item.s>=bestScore-config.variety; });
    return equals[Math.floor(Math.random()*equals.length)].a;
  }

  var depth=config.depth,actions=allActions(pieces,aiPlayer),scored=[];
  for(var i=0;i<actions.length;i++){
    var action=actions[i],result=Rules.resolveTurn(pieces,aiPlayer,action);
    var score,suicide=false,kingKill=false;
    if(result.eliminated && result.eliminated.type===KING){
      if(result.eliminated.owner===aiPlayer){ score=-100000-depth; suicide=true; }
      else { score=100000+depth; kingKill=true; }
    } else {
      score=evaluatePosition(result.np,aiPlayer,difficulty,aiPlayer,passiveTurns);
      score+=initiativeBonus(pieces,result.np,aiPlayer,action,config,passiveTurns);
      if(result.eliminated){
        score+=(result.eliminated.owner===aiPlayer ? -PIECE_VALUE[result.eliminated.type] : PIECE_VALUE[result.eliminated.type])*4;
      }
    }
    scored.push({a:action,s:score,res:result,suicide:suicide,kingKill:kingKill});
  }
  scored.sort(function(a,b){ return b.s-a.s; });
  var limit=Math.min(scored.length,config.candidates),results=[],alpha=-Infinity,beta=Infinity;
  for(var j=0;j<limit;j++){
    var candidate=scored[j];
    if(candidate.suicide) continue;
    var value;
    if(candidate.kingKill) value=100000+depth;
    else if(depth>1) value=-alphaBeta(candidate.res.np,depth-1,-beta,-alpha,opponent,difficulty,aiPlayer,passiveTurns);
    else value=candidate.s;
    results.push({a:candidate.a,s:value});
    if(value>alpha) alpha=value;
  }
  if(!results.length) return {kind:"skip"};
  results.sort(function(a,b){ return b.s-a.s; });
  var bestScore=results[0].s;
  var equals=results.filter(function(item){ return item.s>=bestScore-config.variety; });
  return equals[Math.floor(Math.random()*equals.length)].a;
}

module.exports={
  choose:choose,
  passiveTurn:passiveHumanTurn,
  evaluate:evaluatePosition,
  findKing:findKing,
  laserPressure:laserPressure,
  attackingPresence:attackingPresence
};
