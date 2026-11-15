import assert from "node:assert/strict"
import {test} from "node:test"
import {
  narrativeSchema,narrativeStep,initialNarrativeState,permittedChoices,
  assignmentInput,safetyInput,capEventPoints,capabilityManifest
} from "../lib/scene-platform.ts"

const story={
  title:"The Compass of Echoes",summary:"A two-part shared story about choosing a path.",
  category:"Mystery",
  nodes:[
    {id:"start",title:"At the door",text:"A lantern lights two winding paths beneath the old tower.",
      choices:[
        {id:"north",label:"Follow the northern lantern",next:"middle",setsFlag:"trusted",points:5,proposeTask:"Find the clue"},
        {id:"south",label:"Follow the quiet garden",next:"middle",points:0,proposeTask:""}
      ]},
    {id:"middle",title:"The secret room",text:"A door opens only when the companions have found a token.",
      choices:[
        {id:"trust",label:"Read the secret inscription",next:"end",requiresFlag:"trusted",points:2,proposeTask:""},
        {id:"continue",label:"Take the safe way outside",next:"end",points:0,proposeTask:""}
      ]},
    {id:"end",title:"The last page",text:"Together, the explorers return home after their shared adventure.",
      choices:[]}
  ]
}
test("narrative validation requires reachable unique chapters, bounded effects and an ending",()=>{
  assert.equal(narrativeSchema.safeParse(story).success,true)
  assert.equal(narrativeSchema.safeParse({...story,nodes:story.nodes.slice(0,2)}).success,false)
  assert.equal(narrativeSchema.safeParse({...story,nodes:[...story.nodes,story.nodes[2]]}).success,false)
  const invalid=structuredClone(story)
  invalid.nodes[0].choices[0].points=500
  assert.equal(narrativeSchema.safeParse(invalid).success,false)
  const code=structuredClone(story)
  code.nodes[0].choices[0].proposeTask="x"
  assert.equal(narrativeSchema.safeParse(code).success,false)
  const unreachable=structuredClone(story)
  unreachable.nodes[0].choices.forEach(x=>x.next="end")
  assert.equal(narrativeSchema.safeParse(unreachable).success,false)
})
test("branch progress and flags are deterministic with no ledger side effects",()=>{
  const definition=narrativeSchema.parse(story)
  const start=structuredClone(initialNarrativeState)
  assert.deepEqual(permittedChoices(definition,start).map(x=>x.id),["north","south"])
  const step=narrativeStep(definition,start,"north")
  assert.equal(step.state.nodeId,"middle")
  assert.deepEqual(step.state.flags,["trusted"])
  assert.equal(step.choice.points,5)
  assert.equal(step.choice.proposeTask,"Find the clue")
  assert.deepEqual(permittedChoices(definition,step.state).map(x=>x.id),["trust","continue"])
  const last=narrativeStep(definition,step.state,"trust")
  assert.equal(last.finished,true)
  assert.equal(last.state.decisions,2)
  assert.deepEqual(start,initialNarrativeState)
  assert.throws(()=>narrativeStep(definition,start,"trust"))
  const safe=narrativeStep(definition,start,"south")
  assert.deepEqual(permittedChoices(definition,safe.state).map(x=>x.id),["continue"])
  assert.throws(()=>narrativeStep(definition,safe.state,"trust"))
})
test("inventory gates choices and random outcomes use bounded deterministic rolls",()=>{
  const definition=narrativeSchema.parse(story)
  definition.nodes[0].choices[0].grantItem="copper-key"
  definition.nodes[0].choices[0].randomTargets=[{next:"middle",weight:4},{next:"end",weight:6}]
  definition.nodes[1].choices[0].requiresItem="copper-key"
  definition.nodes[1].choices[0].consumeItem="copper-key"
  const start=structuredClone(initialNarrativeState)
  const first=narrativeStep(definition,start,"north",0)
  assert.equal(first.targetId,"middle")
  assert.deepEqual(first.state.items,["copper-key"])
  const last=narrativeStep(definition,first.state,"trust")
  assert.equal(last.finished,true)
  assert.deepEqual(last.state.items,[])
  const alternate=narrativeStep(definition,start,"north",9)
  assert.equal(alternate.targetId,"end")
  assert.equal(alternate.finished,true)
  assert.throws(()=>narrativeStep(definition,start,"north",10),/Invalid encounter roll/)
  const locked=narrativeStep(definition,start,"south")
  assert.deepEqual(permittedChoices(definition,locked.state).map(c=>c.id),["continue"])
})

test("point effects are bounded and no financial mutation capability exists",()=>{
  assert.equal(capEventPoints(10,55),5)
  assert.equal(capEventPoints(5,60),0)
  assert.throws(()=>capEventPoints(-1,0))
  assert.equal(Object.values(capabilityManifest).map(x=>String(x.mutates)).includes("ledger"),false)
})
test("task steps and personal safety preferences are strongly validated",()=>{
  const task=assignmentInput.parse({title:"Creative milestone",description:"Voluntary task",
    steps:[{id:"write",title:"Write a paragraph",instruction:"Write an original reflection.",
      requiresNote:true,timerMinutes:10}],points:20})
  assert.equal(task.steps[0].timerMinutes,10)
  assert.equal(assignmentInput.safeParse({...task,steps:[task.steps[0],task.steps[0]]}).success,false)
  assert.equal(assignmentInput.safeParse({...task,points:1000}).success,false)
  assert.equal(safetyInput.safeParse({limits:["no-real-money"],shareLimits:false,
    aiOptIn:true,aftercare:"Pause for a check-in"}).success,true)
  assert.equal(safetyInput.safeParse({limits:["dangerous-device-control"],
    shareLimits:true,aiOptIn:true,aftercare:""}).success,false)
})
