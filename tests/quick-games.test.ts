import assert from "node:assert/strict"
import {test} from "node:test"
import {resolveQuickGame,quickGameKeys} from "../lib/quick-games.ts"

test("every quick game has bounded deterministic fictional outcomes",()=>{
  for(const key of quickGameKeys){
    const choice=key==="coin"?"heads":key==="highlow"?"high":key==="cards"?"draw":"1"
    for(let draw=0;draw<6;draw++){
      const value=resolveQuickGame(key,choice,draw)
      assert.ok(value.label.length>0)
      assert.ok(value.delta>=-2500&&value.delta<=1500)
      assert.ok(value.detail.length>0)
    }
  }
})
test("coin flip predictions use a fair three of six draw",()=>{
  assert.equal([...Array(6)].filter((_,i)=>resolveQuickGame("coin","heads",i).delta<0).length,3)
})
test("vault pick has a one-in-three win rate",()=>{
  assert.equal([...Array(6)].filter((_,i)=>resolveQuickGame("vault","2",i).delta<0).length,2)
})
test("outcomes reject invalid choices and out-of-range draws",()=>{
  assert.throws(()=>resolveQuickGame("coin","red",0))
  assert.throws(()=>resolveQuickGame("vault","9",1))
  assert.throws(()=>resolveQuickGame("cards","draw",6))
})
