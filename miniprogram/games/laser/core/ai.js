"use strict";

var C=require("../config/constants.js");
var Rules=require("./rules.js");
var BOARD=C.BOARD,D=C.DIRECTION,P=C.PIECE;
var ROWS=BOARD.rows;
var UP=D.UP,RIGHT=D.RIGHT,DOWN=D.DOWN,LEFT=D.LEFT;
var KING=P.KING,LASER=P.LASER,MIRROR=P.MIRROR,SWITCH=P.SWITCH;
var PIECE_VALUE=C.PIECE_VALUE,AI_LEVELS=C.AI_LEVELS;
var LASER_DIRS=C.LASER_DIRECTIONS;
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
  if(simulation.eliminated && simulation.eliminated.type===KING && simulation.eliminated.owner===1-player)
    return 100;
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

function potentialLaserThreat(pieces,player){
  var laser=Rules.getLaser(pieces,player);
  var king=findKing(pieces,1-player);
  if(!laser || !king) return 0;
  var best=laserPressure(pieces,player);
  for(var i=0;i<pieces.length;i++){
    var piece=pieces[i];
    if(!piece.alive || piece.owner!==player || piece.type!==MIRROR) continue;
    var orig=piece.orientation;
    piece.orientation=(orig+1)%4;
    var p1=laserPressure(pieces,player);
    piece.orientation=(orig+3)%4;
    var p3=laserPressure(pieces,player);
    piece.orientation=orig;
    if(p1>best) best=p1;
    if(p3>best) best=p3;
  }
  var dirs=LASER_DIRS[player];
  var altDir=laser.orientation===dirs[0] ? dirs[1] : dirs[0];
  if(altDir!==laser.orientation){
    var origLaser=laser.orientation;
    laser.orientation=altDir;
    var pl=laserPressure(pieces,player);
    laser.orientation=origLaser;
    if(pl>best) best=pl;
  }
  return best;
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

function evaluatePosition(pieces,player,difficulty,aggressionPlayer,passiveTurns,useForesight){
  var config=_activeConfig||AI_LEVELS[difficulty]||AI_LEVELS.normal;
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
  if(useForesight && config.foresight>0){
    score+=potentialLaserThreat(pieces,player)*config.attack*config.foresight*myBoost;
    score-=potentialLaserThreat(pieces,opponent)*config.caution*opponentBoost;
  }
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

var _transpositionTable={};

function positionHash(pieces,player){
  var parts=[];
  for(var i=0;i<pieces.length;i++){
    var p=pieces[i];
    if(!p.alive) continue;
    parts.push(p.type+p.owner+p.row+','+p.col+p.orientation);
  }
  parts.sort();
  return player+'|'+parts.join(';');
}

function alphaBeta(pieces,depth,alpha,beta,player,difficulty,aggressionPlayer,passiveTurns){
  var opponent=1-player;
  if(!findKing(pieces,player)) return -100000-depth;
  if(!findKing(pieces,opponent)) return 100000+depth;
  if(depth===0) return evaluatePosition(pieces,player,difficulty,aggressionPlayer,passiveTurns,false);

  var hash=positionHash(pieces,player);
  var entry=_transpositionTable[hash];
  if(entry&&entry.depth>=depth){
    if(entry.flag===0) return entry.score;
    if(entry.flag===1&&entry.score>=beta) return entry.score;
    if(entry.flag===2&&entry.score<=alpha) return entry.score;
  }

  var actions=allActions(pieces,player),scored=[];
  for(var i=0;i<actions.length;i++){
    var result=Rules.resolveTurn(pieces,player,actions[i]);
    var score,suicide=false,kingKill=false;
    if(result.eliminated && result.eliminated.type===KING){
      if(result.eliminated.owner===player){ score=-100000-depth; suicide=true; }
      else { score=100000+depth; kingKill=true; }
    } else {
      score=evaluatePosition(result.np,player,difficulty,aggressionPlayer,passiveTurns,false);
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
  if(best===-Infinity) best=evaluatePosition(pieces,player,difficulty,aggressionPlayer,passiveTurns,false);

  var flag=best<=alpha?2:best>=beta?1:0;
  _transpositionTable[hash]={depth:depth,score:best,flag:flag};

  return best;
}

function choose(pieces,aiPlayer,difficulty,passiveTurns){
  difficulty=AI_LEVELS[difficulty] ? difficulty : "normal";
  var config=getAdaptiveConfig(difficulty),opponent=1-aiPlayer;
  _activeConfig=config;
  passiveTurns=Math.min(3,Math.max(0,passiveTurns||0));

  if(difficulty==="hard" && _profile.playerWins>=2){
    var mcResult=mctsChoose(pieces,aiPlayer,250);
    if(mcResult) return mcResult;
  }

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
        score+=evaluatePosition(result.np,aiPlayer,difficulty,aiPlayer,passiveTurns,true);
        score+=initiativeBonus(pieces,result.np,aiPlayer,action,config,passiveTurns);
      }
      return {a:action,s:score,win:win,suicide:suicide};
    });
    var wins=easyScored.filter(function(item){ return item.win; });
    if(wins.length) return wins[Math.floor(Math.random()*wins.length)].a;
    var safe=easyScored.filter(function(item){ return !item.suicide; });
    var pool=safe.length ? safe : easyScored;
    pool.sort(function(a,b){ return b.s-a.s; });
    if(config.blunder>0 && Math.random()>(1-config.blunder)){
      var blunderPool=safe.length ? safe : easyScored;
      return blunderPool[Math.floor(Math.random()*blunderPool.length)].a;
    }
    var top=pool.slice(0,config.candidates),bestScore=top[0].s;
    var equals=top.filter(function(item){ return item.s>=bestScore-config.variety; });
    return equals[Math.floor(Math.random()*equals.length)].a;
  }

  _transpositionTable={};
  var maxDepth=config.depth,actions=allActions(pieces,aiPlayer),scored=[];
  for(var i=0;i<actions.length;i++){
    var action=actions[i],result=Rules.resolveTurn(pieces,aiPlayer,action);
    var score,suicide=false,kingKill=false;
    if(result.eliminated && result.eliminated.type===KING){
      if(result.eliminated.owner===aiPlayer){ score=-100000-maxDepth; suicide=true; }
      else { score=100000+maxDepth; kingKill=true; }
    } else {
      score=evaluatePosition(result.np,aiPlayer,difficulty,aiPlayer,passiveTurns,true);
      score+=initiativeBonus(pieces,result.np,aiPlayer,action,config,passiveTurns);
      if(result.eliminated){
        score+=(result.eliminated.owner===aiPlayer ? -PIECE_VALUE[result.eliminated.type] : PIECE_VALUE[result.eliminated.type])*4;
      }
    }
    scored.push({a:action,s:score,res:result,suicide:suicide,kingKill:kingKill,_deep:score});
  }
  scored.sort(function(a,b){ return b.s-a.s; });
  var limit=Math.min(scored.length,config.candidates);
  var bestResults=null,searchStart=Date.now();
  for(var d=1;d<=maxDepth;d++){
    if(bestResults){
      scored.sort(function(a,b){ return (b._deep||b.s)-(a._deep||a.s); });
    }
    var results=[],alpha=-Infinity,beta=Infinity;
    for(var j=0;j<limit;j++){
      if(bestResults && Date.now()-searchStart>600) break;
      var candidate=scored[j];
      if(candidate.suicide) continue;
      var value;
      if(candidate.kingKill) value=100000+maxDepth;
      else if(d>1) value=-alphaBeta(candidate.res.np,d-1,-beta,-alpha,opponent,difficulty,aiPlayer,passiveTurns);
      else value=candidate.s;
      candidate._deep=value;
      results.push({a:candidate.a,s:value});
      if(value>alpha) alpha=value;
    }
    if(results.length>0) bestResults=results;
  }
  if(!bestResults || !bestResults.length) return {kind:"skip"};
  bestResults.sort(function(a,b){ return b.s-a.s; });
  var bestScore=bestResults[0].s;
  var equals=bestResults.filter(function(item){ return item.s>=bestScore-config.variety; });
  return equals[Math.floor(Math.random()*equals.length)].a;
}

var _profile={
  playerAggression:0.5,
  playerDefensiveness:0.5,
  playerWins:0,
  aiWins:0,
  totalMoves:0
};
var _activeConfig=null;

function resetProfile(){
  _profile.playerAggression=0.5;
  _profile.playerDefensiveness=0.5;
  _profile.playerWins=0;
  _profile.aiWins=0;
  _profile.totalMoves=0;
}

function getProfile(){
  return Object.assign({},_profile);
}

function setProfile(profile){
  if(profile) Object.assign(_profile,profile);
}

function updateProfile(before,after,player,outcome){
  if(outcome==="win"){_profile.playerWins++;return;}
  if(outcome==="loss"){_profile.aiWins++;return;}
  if(!before||!after)return;
  _profile.totalMoves++;
  var bT=laserPressure(before,player),aT=laserPressure(after,player);
  var bO=laserPressure(before,1-player),aO=laserPressure(after,1-player);
  _profile.playerAggression=Math.max(0,Math.min(1,_profile.playerAggression*0.97+(aT-bT)/30));
  _profile.playerDefensiveness=Math.max(0,Math.min(1,_profile.playerDefensiveness*0.97+(bO-aO)/30));
}

function getAdaptiveConfig(difficulty){
  var base=AI_LEVELS[difficulty]||AI_LEVELS.normal;
  var a=_profile.playerAggression,d=_profile.playerDefensiveness;
  return Object.assign({},base,{
    attack:base.attack*(0.85+(1-d)*0.3),
    defense:base.defense*(0.85+a*0.3),
    guard:base.guard*(0.9+a*0.2),
    advance:base.advance*(0.85+(1-d)*0.3)
  });
}

function mctsNode(pieces,player,parent,action){
  return{pieces:pieces,player:player,parent:parent,action:action,visits:0,wins:0,children:null};
}

function mctsSelect(node){
  while(node.children!==null&&node.children.length>0){
    var best=null,bestVal=-Infinity;
    for(var i=0;i<node.children.length;i++){
      var c=node.children[i];
      if(c.visits===0){best=c;break;}
      var ucb1=c.wins/c.visits+1.41*Math.sqrt(Math.log(node.visits)/c.visits);
      if(ucb1>bestVal){bestVal=ucb1;best=c;}
    }
    node=best;
  }
  return node;
}

function mctsExpand(node){
  if(node.children!==null)return node;
  var actions=allActions(node.pieces,node.player);
  node.children=[];
  for(var i=0;i<actions.length;i++){
    var result=Rules.resolveTurn(node.pieces,node.player,actions[i]);
    if(result.eliminated&&result.eliminated.type===KING){
      if(result.eliminated.owner===node.player)continue;
      node.children=[mctsNode(result.np,1-node.player,node,actions[i])];
      return node.children[0];
    }
    node.children.push(mctsNode(result.np,1-node.player,node,actions[i]));
  }
  if(node.children.length===0)return node;
  return node.children[0];
}

function mctsSimulate(node,rootPlayer){
  var pieces=node.pieces.map(function(p){return Object.assign({},p);});
  var player=node.player;
  for(var i=0;i<25;i++){
    if(!findKing(pieces,player))return player===rootPlayer?0:1;
    if(!findKing(pieces,1-player))return player===rootPlayer?1:0;
    var actions=allActions(pieces,player),safe=[];
    for(var j=0;j<actions.length;j++){
      var r=Rules.resolveTurn(pieces,player,actions[j]);
      if(r.eliminated&&r.eliminated.type===KING&&r.eliminated.owner===player)continue;
      if(r.eliminated&&r.eliminated.type===KING)return player===rootPlayer?1:0;
      safe.push(actions[j]);
    }
    if(safe.length===0)return player===rootPlayer?0:1;
    var action=safe[Math.floor(Math.random()*safe.length)];
    var result=Rules.resolveTurn(pieces,player,action);
    pieces=result.np;
    player=1-player;
  }
  var score=evaluatePosition(pieces,rootPlayer,"hard",rootPlayer,0,false);
  return score>0?1:0;
}

function mctsBackprop(node,result,rootPlayer){
  while(node!==null){
    node.visits++;
    if(node.parent){
      var mover=node.parent.player;
      var moverWon=(mover===rootPlayer)?(result===1):(result===0);
      if(moverWon)node.wins++;
    }
    node=node.parent;
  }
}

function mctsChoose(pieces,aiPlayer,timeLimit){
  var root=mctsNode(pieces,aiPlayer,null,null);
  var leaf=mctsExpand(root);
  if(!root.children||root.children.length===0)return null;
  if(root.children.length===1)return root.children[0].action;
  var start=Date.now();
  while(Date.now()-start<timeLimit){
    var node=mctsSelect(root);
    var child=mctsExpand(node);
    var sim=mctsSimulate(child,aiPlayer);
    mctsBackprop(child,sim,aiPlayer);
  }
  var best=root.children[0];
  for(var i=1;i<root.children.length;i++){
    if(root.children[i].visits>best.visits)best=root.children[i];
  }
  return best.action;
}

module.exports={
  choose:choose,
  passiveTurn:passiveHumanTurn,
  evaluate:evaluatePosition,
  findKing:findKing,
  laserPressure:laserPressure,
  potentialLaserThreat:potentialLaserThreat,
  attackingPresence:attackingPresence,
  updateProfile:updateProfile,
  getProfile:getProfile,
  setProfile:setProfile,
  resetProfile:resetProfile,
  mctsChoose:mctsChoose
};
