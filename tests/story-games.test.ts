import assert from "node:assert/strict"
import { test } from "node:test"
import {
  findOfficialStoryGames, officialStoryGameById, officialStoryGameByKey,
  officialStoryGames, storyProgress, type StoryDecision,
} from "../lib/story-games.ts"

test("five public first-party story examples have stable, unique ids and keys", () => {
  assert.equal(officialStoryGames.length, 5)
  assert.equal(new Set(officialStoryGames.map(game => game.id)).size, 5)
  assert.equal(new Set(officialStoryGames.map(game => game.key)).size, 5)
  for (const game of officialStoryGames) {
    assert.match(game.id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    assert.equal(officialStoryGameById(game.id),game)
    assert.equal(officialStoryGameByKey(game.key),game)
    assert.ok(game.opening_prompt.length>20)
    assert.ok(game.rules.length>=20)
  }
})

test("every interactive story choice leads to a playable conclusion", () => {
  for (const game of officialStoryGames) {
    const destinations = new Set<string>()
    const endings = new Set<string>()
    function walk(decisions:StoryDecision[]) {
      const progress=storyProgress(game,decisions)
      destinations.add(progress.node.id)
      if(progress.complete) {
        assert.equal(decisions.length,3,game.title)
        endings.add(progress.node.id)
        return
      }
      assert.ok(decisions.length<3,game.title)
      assert.equal(progress.node.choices.length,2,game.title)
      for(const choice of progress.node.choices) {
        assert.ok(choice.label.length>3,game.title)
        assert.ok(game.nodes[choice.next],game.title)
        walk([...decisions,{official_node_id:progress.node.id,official_choice_id:choice.id}])
      }
    }
    walk([])
    assert.equal(destinations.size,Object.keys(game.nodes).length,game.title)
    assert.equal(endings.size,2,game.title)
  }
})

test("search exposes curated games by title, summary and category", () => {
  assert.equal(findOfficialStoryGames("").length,5)
  assert.deepEqual(findOfficialStoryGames("  crimson  ").map(game=>game.title),["The Crimson Court"])
  assert.ok(findOfficialStoryGames("escape room").some(game=>game.title==="Escape the Velvet Vault"))
  assert.deepEqual(findOfficialStoryGames("a completely absent game"),[])
})

test("story progression rejects out-of-order or invented choices", () => {
  const game=officialStoryGames[0]
  assert.throws(()=>storyProgress(game,[{official_node_id:"route-0",official_choice_id:"route-0"}]),/node mismatch/)
  assert.throws(()=>storyProgress(game,[{official_node_id:"start",official_choice_id:"fake"}]),/choice mismatch/)
  const one=storyProgress(game,[{official_node_id:"start",official_choice_id:"route-1"}])
  assert.equal(one.node.id,"route-1")
  assert.equal(one.step,2)
  assert.equal(one.complete,false)
})
