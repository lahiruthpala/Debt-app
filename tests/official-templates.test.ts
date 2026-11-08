import {test} from "node:test"
import assert from "node:assert/strict"
import {contractDefinitionSchema} from "../lib/contract-rules.ts"
import {findOfficialTemplates,officialTemplates} from "../lib/official-templates.ts"

test("exactly twenty official debt contracts validate and have stable unique identifiers",()=>{
  assert.equal(officialTemplates.length,20)
  assert.equal(new Set(officialTemplates.map(x=>x.id)).size,20)
  assert.equal(new Set(officialTemplates.map(x=>x.title)).size,20)
  for(const item of officialTemplates){
    assert.equal(item.is_official,true)
    assert.equal(item.published,true)
    assert.equal(contractDefinitionSchema.safeParse(item).success,true,item.title)
    assert.ok(item.modules.length>=2 && item.modules.length<=8,item.title)
    assert.equal(new Set(item.modules.map(m=>m.id)).size,item.modules.length)
    for(const module of item.modules){
      if(module.type==="tasks")assert.equal(new Set(module.tasks.map(task=>task.id)).size,module.tasks.length)
      if(module.type==="random"){
        assert.ok(module.outcomes.some(x=>x.weight>1))
        assert.ok(module.outcomes.reduce((sum,x)=>sum+x.weight,0)>module.outcomes.length)
      }
    }
  }
})

test("official discovery filters by title, category and module",()=>{
  assert.equal(findOfficialTemplates("").length,20)
  assert.deepEqual(findOfficialTemplates("labyrinth").map(x=>x.title),["Labyrinth of Clues"])
  assert.ok(findOfficialTemplates("arcade").some(x=>x.title==="Neon Arcade Nights"))
  assert.ok(findOfficialTemplates("Mystery Door").some(x=>x.title==="Labyrinth of Clues"))
  assert.equal(findOfficialTemplates("A NONEXISTENT GAME 92378").length,0)
})
