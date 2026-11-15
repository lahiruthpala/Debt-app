/**
 * First-party, versioned, choice-driven stories. These are virtual catalog entries,
 * not community accounts or executable user content.
 * Keep keys and node/choice ids unchanged for games that already have sessions.
 */
export type StoryChoice = { id: string; label: string; next: string }
export type StoryNode = { id: string; chapter: string; text: string; choices: StoryChoice[] }
export type StoryDecision = { official_node_id: string | null; official_choice_id: string | null }
export type OfficialStoryGame = {
  id: string; key: string; title: string; summary: string; category: string;
  rules: string; opening_prompt: string; nodes: Record<string, StoryNode>
}
type Route = { label: string; text: string }
type Beat = { label: string; text: string }
type Blueprint = {
  id: string; key: string; title: string; summary: string; category: string;
  opening: string; routes: [Route, Route]; beats: [Beat, Beat];
  endings: [Beat, Beat]
}

function buildStory(data: Blueprint): OfficialStoryGame {
  const nodes: Record<string, StoryNode> = {
    start: {
      id: "start", chapter: "The opening", text: data.opening,
      choices: data.routes.map((route, i) => ({ id: "route-" + i, label: route.label, next: "route-" + i })),
    },
  }
  data.routes.forEach((route, i) => {
    nodes["route-" + i] = {
      id: "route-" + i, chapter: "The discovery", text: route.text,
      choices: data.beats.map((beat, j) => ({ id: "beat-" + j, label: beat.label, next: "beat-" + j })),
    }
  })
  data.beats.forEach((beat, i) => {
    nodes["beat-" + i] = {
      id: "beat-" + i, chapter: "The turning point", text: beat.text,
      choices: data.endings.map((ending, j) => ({ id: "ending-" + j, label: ending.label, next: "ending-" + j })),
    }
  })
  data.endings.forEach((ending, i) => {
    nodes["ending-" + i] = { id: "ending-" + i, chapter: "The ending", text: ending.text, choices: [] }
  })
  return {
    id: data.id, key: data.key, title: data.title, summary: data.summary,
    category: data.category, opening_prompt: data.opening, nodes,
    rules: "A cooperative, fictional three-decision adventure. Either player may make the opening choice; then partners alternate choosing one of the on-screen options. Each choice reveals the next chapter. The third choice reveals an ending and completes the story. No choice changes any debt balance or contract terms. Either partner may stop the session early.",
  }
}

export const officialStoryGames: OfficialStoryGame[] = [
  buildStory({
    id: "5a0f0000-7d8e-4c19-a730-000000000001", key: "midnight-ledger-v1",
    title: "The Midnight Ledger", category: "Mystery",
    summary: "A missing page, a masked bookkeeper, and two ways to uncover the truth behind a fictional debt.",
    opening: "At midnight, the library clock strikes thirteen. A page has vanished from the royal ledger, and an unsigned note reads: \"Find the truth before dawn.\" Where do you begin?",
    routes: [
      {label: "Follow the torn receipt", text: "The receipt leads beneath the library to a room full of sealed ledgers. One book still feels warm."},
      {label: "Question the masked bookkeeper", text: "The bookkeeper admits someone altered the figures, but will only reveal a clue in exchange for a promise."},
    ],
    beats: [
      {label: "Compare the secret records", text: "The numbers do not match. A hidden watermark reveals that the disputed debt was invented for a royal performance."},
      {label: "Set a clever decoy", text: "Your decoy draws the forger out of the shadows. They offer you the missing page, but ask you to protect their identity."},
    ],
    endings: [
      {label: "Reveal the evidence to the court", text: "By dawn, the court sees the original figures. The fictional claim is dissolved, and your partnership earns the title of Master Detectives."},
      {label: "Keep the secret and rewrite the tale", text: "You seal the evidence in a velvet box and write a better ending together. The mystery becomes a legend rather than a debt."},
    ],
  }),
  buildStory({
    id: "5a0f0000-7d8e-4c19-a730-000000000002", key: "velvet-vault-v1",
    title: "Escape the Velvet Vault", category: "Escape Room",
    summary: "Choose passages, negotiate with a mechanical guardian, and escape a luxurious puzzle vault.",
    opening: "A velvet door clicks shut behind you. Above it, three glowing numbers begin to fade. A bronze guardian asks: \"Which path will you trust?\"",
    routes: [
      {label: "Enter the mirror corridor", text: "Every mirror shows a different exit. A scratched arrow on the floor points to the only reflection without a shadow."},
      {label: "Climb the winding staircase", text: "The stairs lead to a gallery of clocks. One clock runs backward and conceals a small brass key."},
    ],
    beats: [
      {label: "Solve the guardian's riddle", text: "The guardian asks what grows when shared. Together you answer: trust. Its gears slow, revealing a final control panel."},
      {label: "Try the hidden mechanism", text: "A carefully turned gear opens the vault's control panel. Two switches remain, each marked with a different symbol."},
    ],
    endings: [
      {label: "Pull the silver release", text: "The silver switch opens the door into morning sunlight. The guardian bows and records a successful team escape."},
      {label: "Pull the golden release", text: "The golden switch reveals a secret rooftop garden. You find an even better exit and a note congratulating your teamwork."},
    ],
  }),
  buildStory({
    id: "5a0f0000-7d8e-4c19-a730-000000000003", key: "crimson-court-v1",
    title: "The Crimson Court", category: "Roleplay",
    summary: "Defend a fantasy kingdom at a theatrical hearing where every argument changes the story.",
    opening: "You stand before the Crimson Court. A royal decree claims the moon owes the kingdom seven silver promises. The judge invites you to present a case.",
    routes: [
      {label: "Challenge the royal decree", text: "The court falls silent. You point out that the decree is missing the seal of the Moon Council."},
      {label: "Call the stargazer as witness", text: "A stargazer enters carrying an atlas. The stars, they insist, have never signed any agreement."},
    ],
    beats: [
      {label: "Offer a logical argument", text: "Your reasoning wins the gallery's attention. The judge agrees that fictional obligations need clear and voluntary terms."},
      {label: "Offer a creative compromise", text: "You propose replacing the dispute with an annual festival of storytelling. The whole court begins to whisper excitedly."},
    ],
    endings: [
      {label: "Ask for a fair verdict", text: "The judge strikes down the decree and appoints you Keepers of Fair Promises. The courtroom erupts in applause."},
      {label: "Invite everyone to a new pact", text: "The court signs a completely voluntary storytelling pact. The moon shines brighter as a celebration begins."},
    ],
  }),
  buildStory({
    id: "5a0f0000-7d8e-4c19-a730-000000000004", key: "neon-courier-v1",
    title: "Neon City Courier", category: "Adventure",
    summary: "Deliver a mysterious digital receipt through a cyberpunk city before its countdown reaches zero.",
    opening: "Rain blurs the neon streets. Your courier drone carries a glowing receipt to the Archive Tower, but a citywide blackout is moments away.",
    routes: [
      {label: "Take the skybridge shortcut", text: "The skybridge sways in the storm. A friendly maintenance robot offers a map of the upper city."},
      {label: "Travel through the night market", text: "Vendors light your way with lanterns. A musician mentions an underground tunnel leading toward the tower."},
    ],
    beats: [
      {label: "Decode the receipt's message", text: "You discover the receipt is actually a request to restore the city's public memory archive, not a demand for payment."},
      {label: "Ask the city network for help", text: "Thousands of tiny lights answer your signal, guiding the drone safely around the blackout."},
    ],
    endings: [
      {label: "Deliver it to the archivist", text: "The archivist restores the missing records just in time. The city celebrates two couriers who chose to help."},
      {label: "Broadcast the discovery to everyone", text: "The message lights every public screen. Neighbors rally to protect their shared archive, and the blackout loses its power."},
    ],
  }),
  buildStory({
    id: "5a0f0000-7d8e-4c19-a730-000000000005", key: "secret-auction-v1",
    title: "The Secret Auction", category: "Strategy",
    summary: "Outwit a masked auctioneer and win a symbolic treasure using clues, alliances, and bold choices.",
    opening: "At a masked auction, the last lot is a sealed box labeled \"One Promise, No Price.\" Everyone has a bid, but no one knows what the box contains.",
    routes: [
      {label: "Inspect the auction catalog", text: "A footnote reveals that the box belongs to the winner of an ancient puzzle, not the highest bidder."},
      {label: "Befriend the quiet bidder", text: "The quiet bidder shares a clue: the treasure can only be opened by two people who cooperate."},
    ],
    beats: [
      {label: "Solve the auctioneer's puzzle", text: "The puzzle's answer is generosity. The auctioneer removes the price tag and offers you a final decision."},
      {label: "Form an alliance at the table", text: "Your alliance convinces the room that trust is worth more than a bid. The auctioneer allows a final choice."},
    ],
    endings: [
      {label: "Open the box together", text: "Inside is a blank storybook and two pens. You win the right to invent the treasure's next chapter."},
      {label: "Gift the box to the whole room", text: "The auction becomes a storytelling night. Everyone contributes a page, and the promised treasure belongs to all."},
    ],
  }),
]

export function findOfficialStoryGames(query: string): OfficialStoryGame[] {
  const term = query.trim().toLocaleLowerCase()
  return officialStoryGames.filter(game =>
    !term || [game.title, game.summary, game.category].some(value => value.toLocaleLowerCase().includes(term))
  )
}

export function officialStoryGameById(id: string): OfficialStoryGame | undefined {
  return officialStoryGames.find(game => game.id === id)
}

export function officialStoryGameByKey(key: string): OfficialStoryGame | undefined {
  return officialStoryGames.find(game => game.key === key)
}

export function storyProgress(game: OfficialStoryGame, decisions: StoryDecision[]) {
  let node = game.nodes.start
  for (const decision of decisions) {
    if (decision.official_node_id !== node.id) throw new Error("Story history node mismatch")
    const choice = node.choices.find(option => option.id === decision.official_choice_id)
    if (!choice) throw new Error("Story history choice mismatch")
    const next = game.nodes[choice.next]
    if (!next) throw new Error("Story target missing")
    node = next
  }
  return { node, step: decisions.length + 1, complete: node.choices.length === 0 }
}
