import { contractDefinitionSchema, type ContractDefinition } from "./contract-rules.ts"

/**
 * First-party curated recipes: public, immutable and safe to customize.
 * These are virtual system entries, NOT privileged login accounts.
 * Every player clones a template into their own account before proposing it.
 */
type ModuleRecipe = {type:string;name:string;[key:string]:unknown}
type Recipe = {title:string;description:string;category:string;terms:ContractDefinition["terms"];modules:ModuleRecipe[]}
export type OfficialTemplate = ContractDefinition & {
  id:string; author_id:string; author_handle:string; published:true; is_official:true; created_at:string
}
const uid=(n:number)=>"7fd2aa00-5ff1-4ae0-bb65-"+n.toString(16).padStart(12,"0")
const d=(name:string,stake:number,sides=6,cooldownHours=12):ModuleRecipe=>({type:"dice",name,stake,sides,cooldownHours})
const w=(name:string,cooldownHours:number,outcomes:[string,number][]):ModuleRecipe=>({
  type:"wheel",name,cooldownHours,outcomes:outcomes.map(([label,delta])=>({label,delta}))
})
const r=(name:string,cooldownHours:number,outcomes:[string,number,number][]):ModuleRecipe=>({
  type:"random",name,cooldownHours,outcomes:outcomes.map(([label,delta,weight])=>({label,delta,weight}))
})
const c=(name:string,reward:number,latePenalty:number,cooldownHours:number):ModuleRecipe=>({
  type:"checkin",name,reward,latePenalty,cooldownHours
})
const t=(name:string,items:[string,number][]):ModuleRecipe=>({
  type:"tasks",name,tasks:items.map(([label,reward])=>({label,reward}))
})
const recipe=(title:string,description:string,category:string,principal:number,monthlyRate:number,weeklyTarget:number,lateFee:number,modules:ModuleRecipe[]):Recipe=>({
  title,description,category,terms:{principal,monthlyRate,weeklyTarget,lateFee},modules
})

const recipes:Recipe[]=[
  recipe("Velvet Roulette","Spin for surprising fictional credits, house penalties and a late-night secret envelope. Every turn can flip the balance.","Chance",45000,1,2500,150,[
    w("Velvet Wheel",12,[["Golden ticket",-2500],["House tip",650],["Double trouble",1700],["Mercy gift",-800],["Quiet moment",0],["Lucky escape",-1200]]),
    r("Sealed Envelope",24,[["Hidden treasure",-2000,2],["A tiny fine",500,3],["Nothing inside",0,5]]),
    c("Nightly Ritual",350,150,24)
  ]),
  recipe("Royal Dice Duel","Challenge the house to a regal dice duel; complete royal missions to earn a second route to imaginary freedom.","Strategy",65000,2,3600,300,[
    d("King versus House",450,12,12),
    w("Royal Rewards",24,[["Crown's blessing",-1700],["Court fee",1000],["Blank decree",0],["Secret pardon",-900]]),
    t("Royal Decrees",[["Write a three-line royal proclamation",900],["Invent a fair new royal game rule",1300]])
  ]),
  recipe("Midnight Mystery Box","Pick from weighted mystery outcomes, complete clues and check in to unravel the next chapter of this fictional contract.","Mystery",38000,1,1800,120,[
    r("The Black Box",12,[["Silk ribbon reward",-1800,2],["Phantom toll",1100,2],["Clue card",-600,3],["Empty box",0,5]]),
    t("Hidden Clues",[["Write a mysterious two-sentence clue",650],["Solve or invent a simple riddle together",1100]]),
    c("Midnight Check-in",400,250,24)
  ]),
  recipe("The Great Ledger Heist","Team up for a make-believe vault mission: challenges open imaginary doors, while dice and events change your score.","Adventure",95000,3,5200,400,[
    t("Heist Missions",[["Design a fictional vault map",1000],["Invent a clever getaway plan",1200],["Write a secret two-word code",550]]),
    d("Vault Security Roll",600,10,24),
    r("Security Alert",12,[["Hidden shortcut",-1700,3],["Laser alarm",2000,1],["All clear",0,6]])
  ]),
  recipe("Neon Arcade Nights","A fast-paced arcade mix: roll bright dice, spin the prize machine and collect mini rewards from agreed check-ins.","Arcade",30000,0,1500,100,[
    d("Pixel Duel",250,8,4),
    w("Prize Machine",4,[["Extra life",-900],["Jackpot",-1900],["Coin tax",400],["Power surge",800],["Blank screen",0]]),
    c("Save Point",200,100,6)
  ]),
  recipe("Dragon's Treasury","Guard a legendary imaginary hoard, survive dragon dice and earn credits by completing heroic story missions.","Adventure",150000,3,7500,550,[
    d("Dragon Duel",450,20,24),
    r("Dragon's Mood",24,[["Dragon sleeps",0,5],["A golden scale",-3500,2],["Smoke penalty",1500,2],["Treasure room",-1200,3]]),
    t("Heroic Feats",[["Invent a dragon's secret weakness",850],["Write a short treasure-hunt riddle",1150]])
  ]),
  recipe("Moonlit Promises","A gentle cooperative fantasy contract with supportive challenges, daily consistency rewards and low-stakes spins.","Cooperative",22000,0,1200,0,[
    c("Moonrise Check-in",500,0,24),
    t("Promises Kept",[["Share a fictional win from the day",450],["Create a fun two-line bedtime story",600]]),
    w("Moon Wheel",24,[["Silver glow",-700],["Quiet moon",0],["Warm starlight",-300],["Passing cloud",250]])
  ]),
  recipe("Casino of Shadows","Dark-glamour, higher-variance imaginary games: duel the house, reveal odds-weighted surprises and face the velvet wheel.","High Stakes",185000,4,9000,650,[
    d("Shadow Dice",800,10,24),
    r("House Secrets",24,[["Secret jackpot",-5000,1],["The house collects",3000,2],["Black card",-1000,3],["No reveal",0,6]]),
    w("Velvet Table",24,[["Fortune",-3500],["House edge",1800],["Nothing",0],["Second chance",-900]])
  ]),
  recipe("Crown Quest Daily","Turn a recurring check-in into a crown quest, with handcrafted daily challenges and the occasional surprise reward.","Ritual",48000,1,2600,200,[
    c("Daily Crown",650,450,12),
    t("Royal To-Dos",[["Invent a new court nickname",350],["Write a playful quest report",750],["Complete a shared fictional puzzle",900]]),
    r("Crown Surprise",24,[["Royal gift",-1000,3],["Court toll",650,2],["No decree",0,5]])
  ]),
  recipe("Labyrinth of Clues","Explore a branching imaginary maze by solving creative challenges, spinning passage wheels and opening random doors.","Mystery",72000,2,3800,250,[
    t("Maze Puzzles",[["Create a three-step maze escape plan",850],["Write a clue for a hidden doorway",850],["Solve a partner-made logic riddle",1000]]),
    w("Choose a Passage",12,[["Secret exit",-1900],["Trap door",1100],["Side passage",0],["Map found",-700]]),
    r("Mystery Door",24,[["Safe passage",0,5],["Locked gate",750,2],["Golden key",-1200,3]])
  ]),
  recipe("Lucky Seven Showdown","Seven-sided dice and a seven-stop fortune wheel make every imaginary duel a little unpredictable.","Chance",77000,1,4000,350,[
    d("Lucky d7",777,7,12),
    w("Seven Wonders",24,[["Lucky charm",-1700],["Mystery bonus",-900],["House toll",777],["Bonus tax",1400],["Free pass",0],["Small gift",-300],["Twist",500]]),
    c("Seven O'Clock Check-in",250,0,24)
  ]),
  recipe("The Golden Hour","Keep the fictional ledger sparkling with a daily golden-hour ritual, rewarding partner-verified mini adventures and prize spins.","Cooperative",42000,0,2100,100,[
    c("Golden Check-in",750,350,24),
    w("Sunset Spin",12,[["Warm light",-1400],["Golden ray",-750],["Cloud fee",400],["Quiet sky",0]]),
    t("Golden Tasks",[["Write a compliment as a fantasy character",400],["Create a miniature treasure quest",800]])
  ]),
  recipe("Starlight Gambit","Risk a cosmic die roll against the universe and discover weighted astronomical events before completing starbound missions.","Adventure",132000,3,6800,450,[
    r("Cosmic Weather",24,[["Shooting star",-2800,2],["Meteor toll",1800,1],["Clear sky",0,6],["Nebula gift",-900,3]]),
    d("Galactic d12",550,12,12),
    t("Star Missions",[["Name a new fictional constellation",450],["Write a mini message from space",850]])
  ]),
  recipe("Phantom Auction","A make-believe auction of clues and powers, with changing fortune and rewards for inventive bids made only in the story.","Strategy",88000,2,4600,280,[
    w("Phantom Lot Wheel",12,[["Rare token",-1500],["Faux auction fee",950],["Secret card",-600],["No bid",0]]),
    t("Auction Adventures",[["Invent an impossible auction item",600],["Write a funny sales pitch",700]]),
    c("Auction Bell",350,250,24)
  ]),
  recipe("Wildcard Wonderland","A colorful, mischievous tabletop fantasy mixing weighted surprise cards, wheel prizes and quick-fire dice.","Arcade",105000,2,5500,350,[
    r("Wild Card Draw",6,[["Rainbow prize",-2000,2],["Joker twist",1000,2],["No wild card",0,5],["Wonderland key",-500,3]]),
    w("Wonder Wheel",12,[["Confetti",-700],["Tea tax",500],["Crown",-2200],["Blank card",0],["Mad hatter",1500]]),
    d("Joker's Dice",350,8,8)
  ]),
  recipe("Storm or Shelter","Every agreed check-in is a shelter from a fictional storm; random forecasts create suspense without automatic penalties.","Ritual",58000,1,3000,150,[
    r("Storm Forecast",12,[["Thunder penalty",1200,2],["Rainbow reward",-1600,3],["Passing clouds",0,6],["Safe harbor",-500,4]]),
    c("Shelter Check-in",500,250,24),
    t("Shelter Missions",[["Write a fictional weather forecast",450],["Invent a secret shelter password",500]])
  ]),
  recipe("Secret Code Vault","Break a pretend code to collect imaginary credits; combine logic challenges with tense dice and surprise keys.","Mystery",99000,2,5000,420,[
    t("Cipher Challenges",[["Design a four-character fantasy code",600],["Create a substitution cipher clue",850],["Trade and solve short riddles",1150]]),
    d("Security Dice",550,10,12),
    r("Vault Key",24,[["Master key",-2400,1],["Wrong key",900,3],["Door unlocked",-800,3],["Try again",0,7]])
  ]),
  recipe("Crown and Coin","Play king of the imaginary coins with rewarding duels, queen-of-hearts wheel draws and creative royal quests.","Strategy",67000,1,3200,200,[
    d("Coin Duel",400,6,12),
    w("Royal Coin Toss",6,[["Crown",-1400],["Shield",-650],["Toll",700],["Lucky coin",0]]),
    t("Court Games",[["Write an imaginary knight's oath",600],["Invent a coin-flip celebration",500]])
  ]),
  recipe("Lantern Festival","Float through a make-believe festival of eight prize lanterns, gentle check-ins and surprise fireworks.","Cooperative",34000,0,1700,80,[
    w("Eight Lanterns",12,[["Red lantern",500],["Blue lantern",-500],["Gold lantern",-1400],["Silver lantern",-800],["Green lantern",0],["Violet lantern",250],["Orange lantern",-650],["Pink lantern",350]]),
    c("Light a Lantern",400,150,24),
    r("Festival Fireworks",24,[["Glitter bonus",-700,3],["Spark penalty",350,2],["Quiet sky",0,6]])
  ]),
  recipe("The Velvet Carnival","The full fantasy arcade: daring dice, a colorful wheel, weighted mystery events, check-ins and mini quests in one contract.","High Stakes",250000,5,12000,750,[
    d("Carnival Showdown",750,12,24),
    w("Grand Prize Wheel",12,[["Gold prize",-4500],["Confetti",-1200],["House penalty",2200],["Lucky charm",-650],["Midnight tax",1000],["Nothing",0]]),
    r("Surprise Booth",24,[["Rare jackpot",-5000,1],["Sideshow fee",1600,2],["Small prize",-900,4],["Empty box",0,6]]),
    c("Carnival Ticket",650,500,24),
    t("Carnival Missions",[["Design a funny carnival attraction",650],["Write a two-line prize announcement",900],["Invent a new non-financial carnival rule",1100]])
  ]),
]

export const officialTemplates:OfficialTemplate[]=recipes.map((item,index)=>{
  const modules=item.modules.map((module,position)=>({
    ...module,
    id:uid(100+index*10+position),
    ...(module.type==="tasks"?{
      tasks:(module.tasks as {label:string;reward:number}[]).map((task,step)=>({
        ...task,id:uid(10000+index*100+step)
      }))
    }:{})
  }))
  const definition=contractDefinitionSchema.parse({...item,modules})
  return {
    ...definition,
    id:uid(index+1),
    author_id:"system:velvet-ledger",
    author_handle:"velvet_official",
    published:true,
    is_official:true,
    created_at:"2026-11-08T00:00:00.000Z",
  }
})

export function findOfficialTemplates(search:string):OfficialTemplate[]{
  const q=search.trim().toLocaleLowerCase()
  if(!q)return officialTemplates
  return officialTemplates.filter(t=>
    [t.title,t.description,t.category,...t.modules.map(m=>m.name)].some(s=>s.toLocaleLowerCase().includes(q))
  )
}
