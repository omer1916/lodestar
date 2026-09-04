window.RP = window.RP || {};

RP.optimize = (function(){
  "use strict";

  var hav = function(a,b){ return RP.geo.haversine(a,b); };

  // A cost matrix lets the same heuristics run on either straight-line distance
  // or real road distance/duration from TomTom Matrix.
  function haversineMatrix(points){
    return points.map(function(a){ return points.map(function(b){ return hav(a,b); }); });
  }

  function pathCost(order, m){
    var d = 0;
    for(var i=0;i<order.length-1;i++) d += m[order[i]][order[i+1]];
    return d;
  }

  function nearestNeighborOrder(points, m, fixedEndIdx){
    var n = points.length;
    var visited = new Array(n).fill(false);
    visited[0] = true;
    var order = [0];
    var lockEnd = (fixedEndIdx != null);
    for(var k=0;k<n-1;k++){
      var cur = order[order.length-1];
      var remaining = [];
      for(var i=0;i<n;i++){
        if(!visited[i] && !(lockEnd && i===fixedEndIdx)) remaining.push(i);
      }
      if(remaining.length === 0){
        if(lockEnd && !visited[fixedEndIdx]){ order.push(fixedEndIdx); visited[fixedEndIdx]=true; }
        break;
      }
      var best = remaining[0], bestD = m[cur][best];
      for(var j=1;j<remaining.length;j++){
        var d = m[cur][remaining[j]];
        if(d < bestD){ bestD = d; best = remaining[j]; }
      }
      order.push(best); visited[best] = true;
    }
    if(lockEnd && order[order.length-1] !== fixedEndIdx){ order.push(fixedEndIdx); }
    return order;
  }

  /* 2-opt local search over an open path. order[0] is fixed (start).
     If lockEnd, the final value is pinned but the edge into it can be rewired.
     penalty(order) adds soft-constraint cost (e.g. time-window violations). */
  function twoOpt(order, m, lockEnd, penalty){
    var n = order.length;
    if(n < 4) return order;
    var lastMovable = lockEnd ? n-2 : n-1;
    var improved = true, guard = 0;
    while(improved && guard < 80){
      improved = false; guard++;
      for(var i=1;i<lastMovable;i++){
        for(var j=i+1;j<=lastMovable;j++){
          var a = order[i-1], b = order[i], c = order[j];
          var hasNext = (j+1) < n;
          var d = hasNext ? order[j+1] : null;

          var before = m[a][b];
          var after = m[a][c];
          if(hasNext){ before += m[c][d]; after += m[b][d]; }

          var delta = after - before;
          if(penalty){
            var cand = order.slice();
            var seg0 = cand.slice(i, j+1).reverse();
            for(var t0=0;t0<seg0.length;t0++) cand[i+t0] = seg0[t0];
            delta += penalty(cand) - penalty(order);
          }

          if(delta < -1e-9){
            var seg = order.slice(i, j+1).reverse();
            for(var t=0;t<seg.length;t++) order[i+t] = seg[t];
            improved = true;
          }
        }
      }
    }
    return order;
  }

  /* Simulated annealing — better than plain 2-opt once the stop count grows,
     because it can accept temporarily worse moves and escape local minima. */
  function simulatedAnnealing(order, m, lockEnd, penalty, iterations){
    var n = order.length;
    var lastMovable = lockEnd ? n-2 : n-1;
    if(lastMovable - 1 < 2) return order;

    function total(o){ return pathCost(o, m) + (penalty ? penalty(o) : 0); }

    var current = order.slice(), best = order.slice();
    var curCost = total(current), bestCost = curCost;
    var iters = iterations || 12000;
    /* Temperature must be comparable to what ONE move changes, not to the whole
       tour. Scaled to the tour it accepted ~93% of uphill moves, so the chain
       was a random walk and the stage was a no-op in ~92% of runs. */
    var T0 = Math.max((curCost / Math.max(2, n)) * 0.6, 1e-3);

    for(var k=0;k<iters;k++){
      var T = T0 * (1 - k/iters);
      if(T <= 0) break;

      var i = 1 + Math.floor(Math.random() * (lastMovable));
      var j = 1 + Math.floor(Math.random() * (lastMovable));
      if(i === j) continue;
      if(i > j){ var tmp = i; i = j; j = tmp; }

      var cand = current.slice();
      if(Math.random() < 0.5){
        var seg = cand.slice(i, j+1).reverse();
        for(var t=0;t<seg.length;t++) cand[i+t] = seg[t];
      } else {
        var moved = cand.splice(i, 1)[0];
        cand.splice(j, 0, moved);
      }

      var candCost = total(cand);
      var delta = candCost - curCost;
      if(delta < 0 || Math.random() < Math.exp(-delta / T)){
        current = cand; curCost = candCost;
        if(curCost < bestCost){ best = current.slice(); bestCost = curCost; }
      }
    }
    return best;
  }

  /* Re-scoring the whole path for every candidate swap makes penalty-aware 2-opt
     O(n^3); past ~40 stops that stalls the UI, so there the annealing pass (which
     is already penalty-aware and linear per step) carries the constraint instead. */
  var PENALTY_2OPT_LIMIT = 40;

  function solveOrder(points, m, lockEnd, fixedEndIdx, penalty){
    var cheapPenalty = points.length <= PENALTY_2OPT_LIMIT ? penalty : null;
    var order = nearestNeighborOrder(points, m, lockEnd ? fixedEndIdx : null);
    order = twoOpt(order, m, lockEnd, cheapPenalty);
    if(points.length > 12){
      order = simulatedAnnealing(order, m, lockEnd, penalty, 15000);
      order = twoOpt(order, m, lockEnd, cheapPenalty);
    }
    return order;
  }

  /* Sweep algorithm: sort stops by bearing around the depot, then fill each
     vehicle in angular order until its capacity is reached. Classic VRP
     construction heuristic — simple, explainable, good enough for city runs. */
  function assignVehicles(start, stops, vehicleCount, capacity){
    var vc = Math.max(1, vehicleCount|0);
    var totalLoadAll = stops.reduce(function(sum,s){ return sum + (Number(s.load)||0); }, 0);
    if(vc === 1 && !capacity){
      return { groups: [stops.slice()], totalLoad: totalLoadAll, overflow: false };
    }

    var withAngle = stops.map(function(s){
      return { stop: s, angle: Math.atan2(s.lat - start.lat, s.lon - start.lon) };
    }).sort(function(a,b){ return a.angle - b.angle; });

    var groups = [];
    var current = [], load = 0;
    // when no capacity is given, split evenly by count instead
    var perVehicle = Math.ceil(withAngle.length / vc);

    withAngle.forEach(function(item){
      var l = Number(item.stop.load) || 0;
      /* Capacity is an ADDITIONAL reason to close a vehicle, not a replacement
         for the even split. Making it exclusive meant that setting a capacity
         while leaving loads at 0 put every stop on vehicle 1 and left the rest
         empty, with no warning. */
      var capFull = capacity > 0 && load + l > capacity && current.length > 0;
      var countFull = current.length >= perVehicle;
      if((capFull || countFull) && groups.length < vc - 1){
        groups.push(current); current = []; load = 0;
      }
      current.push(item.stop); load += l;
    });
    if(current.length) groups.push(current);

    return { groups: groups, totalLoad: totalLoadAll, overflow: capacity > 0 && groups.some(function(g){
      return g.reduce(function(s,x){ return s + (Number(x.load)||0); }, 0) > capacity;
    })};
  }

  /* Time windows are treated as a soft constraint: the optimizer is nudged away
     from orders that arrive late, but a late stop is reported rather than dropped.
     `durMatrix` holds travel minutes between points. */
  function timeWindowPenalty(seqStops, durMatrix, order, startMinutes, serviceMin){
    var service = serviceMin == null ? 5 : serviceMin;
    var t = startMinutes;
    var pen = 0;
    for(var i=1;i<order.length;i++){
      t += durMatrix[order[i-1]][order[i]];
      var s = seqStops[order[i]];
      if(s && s.windowEnd != null && t > s.windowEnd) pen += (t - s.windowEnd);
      if(s && s.windowStart != null && t < s.windowStart) t = s.windowStart;
      t += service;
    }
    return pen;
  }

  function arrivalTimes(order, legDurationsSec, startMinutes, stopsByIdx, serviceMin){
    var service = serviceMin == null ? 5 : serviceMin;
    var t = startMinutes, out = [];
    for(var i=0;i<order.length;i++){
      if(i > 0){
        t += (legDurationsSec[i-1] || 0)/60;
        var s = stopsByIdx[order[i]];
        if(s && s.windowStart != null && t < s.windowStart) t = s.windowStart;
      }
      out.push(t);
      if(i > 0) t += service;
    }
    return out;
  }

  return {
    haversineMatrix: haversineMatrix,
    pathCost: pathCost,
    nearestNeighborOrder: nearestNeighborOrder,
    twoOpt: twoOpt,
    simulatedAnnealing: simulatedAnnealing,
    solveOrder: solveOrder,
    assignVehicles: assignVehicles,
    timeWindowPenalty: timeWindowPenalty,
    arrivalTimes: arrivalTimes
  };
})();
