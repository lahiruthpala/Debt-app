"use client"

import { useEffect, useState, type FormEvent } from "react"

type Game = {
  id:string;author_id:string;author_handle:string;title:string;summary:string;
  category:string;rules:string;opening_prompt:string;published:boolean;play_count:number
}
type GameSession = {id:string;scene_id:string;game_id:string;title_snapshot:string;state:string;created_at:string;started_by_handle:string}
type Turn = {id:string;content:string;created_at:string;actor_id:string;actor_handle:string}
type SessionDetails = {session:{id:string;state:string;scene_id:string;title_snapshot:string;rules_snapshot:string;prompt_snapshot:string;started_by_handle:string};turns:Turn[]}
export type GameScene = {id:string;status:string;connection_state:string;other_handle:string}
type Feedback = (type:"pending"|"success"|"error",message:string)=>void
const blank = {title:"",summary:"",category:"Story",rules:"",openingPrompt:""}
async function queryGame(view:string,params:Record<string,string>={}) {
  const response=await fetch("/api/games?"+new URLSearchParams({view,...params}),{cache:"no-store"})
  const data=await response.json().catch(()=>({}))
  if (!response.ok) throw new Error(data.error || "Could not load games")
  return data
}
async function changeGame(input:Record<string,unknown>) {
  const response=await fetch("/api/games",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(input)})
  const data=await response.json().catch(()=>({}))
  if (!response.ok) throw new Error(data.error || "Game action failed")
  return data
}
const describeError = (error:unknown) => error instanceof Error ? error.message : "Request failed"

export default function CommunityGames({scenes,selectedSceneId,meId,onNotify}:{scenes:GameScene[];selectedSceneId:string;meId:string;onNotify:Feedback}) {
  const [panel,setPanel]=useState<"explore"|"mine"|"sessions">("explore")
  const [games,setGames]=useState<Game[]>([])
  const [mine,setMine]=useState<Game[]>([])
  const [search,setSearch]=useState("")
  const [submittedSearch,setSubmittedSearch]=useState("")
  const [chosenGame,setChosenGame]=useState("")
  const [sceneChoice,setSceneChoice]=useState(selectedSceneId)
  const [sessions,setSessions]=useState<GameSession[]>([])
  const [sessionId,setSessionId]=useState("")
  const [details,setDetails]=useState<SessionDetails|null>(null)
  const [move,setMove]=useState("")
  const [draft,setDraft]=useState(blank)
  const [editing,setEditing]=useState<Game|null>(null)
  const [working,setWorking]=useState(false)
  const activeScenes=scenes.filter(s=>s.status==="active" && s.connection_state==="active")
  const selectedGame=[...games,...mine].find(g=>g.id===chosenGame)
  const sceneForPlay=scenes.find(s=>s.id===sceneChoice)

  async function loadLibrary(q=submittedSearch) {
    try {
      const data=await queryGame("library",{q})
      setGames(data.games);setMine(data.mine)
    } catch(error) { onNotify("error",describeError(error)) }
  }
  async function loadSessions(id=sceneChoice) {
    if(!id){setSessions([]);setSessionId("");setDetails(null);return}
    try {
      const data=await queryGame("sessions",{sceneId:id})
      setSessions(data.sessions)
      setSessionId(current=>data.sessions.some((s:GameSession)=>s.id===current)?current:data.sessions[0]?.id||"")
    } catch(error) { onNotify("error",describeError(error)) }
  }
  async function loadSession(id=sessionId) {
    if(!id){setDetails(null);return}
    try {setDetails(await queryGame("session",{id}))}
    catch(error){onNotify("error",describeError(error))}
  }
  useEffect(()=>{void loadLibrary(submittedSearch)},[submittedSearch])
  useEffect(()=>{
    if(!scenes.some(s=>s.id===sceneChoice)) {
      setSceneChoice(scenes.find(s=>s.id===selectedSceneId)?.id||scenes[0]?.id||"")
    }
  },[scenes,selectedSceneId,sceneChoice])
  useEffect(()=>{void loadSessions(sceneChoice)},[sceneChoice])
  useEffect(()=>{void loadSession(sessionId)},[sessionId])

  async function perform(payload:Record<string,unknown>,after?:(data:{id?:string;message?:string})=>void) {
    if(working)return
    setWorking(true)
    onNotify("pending","Working on your game action…")
    try {
      const result=await changeGame(payload)
      if(after)after(result)
      await Promise.all([loadLibrary(),loadSessions()])
      onNotify("success",result.message||"Changes saved")
      return result
    } catch(error){onNotify("error",describeError(error))}
    finally{setWorking(false)}
  }
  function openEditor(game:Game) {
    setDraft({title:game.title,summary:game.summary,category:game.category,rules:game.rules,openingPrompt:game.opening_prompt})
    setEditing(game)
    setPanel("mine")
  }
  function clearEditor() {setEditing(null);setDraft(blank)}
  async function save(publish:boolean) {
    if(!draft.title.trim()||!draft.summary.trim()||!draft.rules.trim()||!draft.category.trim()) {
      onNotify("error","Complete the title, description, category and rules.");return
    }
    await perform({action:editing?"update":"create",...(editing?{gameId:editing.id}:{}),...draft,publish},()=>{
      clearEditor()
      setPanel("mine")
    })
  }
  async function start(gameId:string) {
    if(!sceneChoice || !sceneForPlay || sceneForPlay.status!=="active") {
      onNotify("error","Choose an active, approved connection scene before playing.");return
    }
    await perform({action:"start",gameId,sceneId:sceneChoice},result=>{
      setPanel("sessions");setSessionId(result.id||"")
      if(result.id)void loadSession(result.id)
    })
  }
  async function submitTurn(e:FormEvent) {
    e.preventDefault()
    const content=move.trim()
    if(!content || !sessionId)return
    await perform({action:"turn",sessionId,content},()=>{
      setMove("")
      void loadSession(sessionId)
    })
  }
  const selectedSession=sessions.find(s=>s.id===sessionId)
  const isOpen=details?.session.id===sessionId && details.session.state==="active"
  const isActiveScene=sceneForPlay?.status==="active" && sceneForPlay.connection_state==="active"

  return <section className="community-studio" aria-label="Community games">
    <div className="community-hero">
      <div><span className="eyebrow">NEW · COMMUNITY GAME STUDIO</span>
        <h2>Make the rules. Share the story.</h2>
        <p>Create original games with your own rules, publish them for everyone to discover, and play together inside a consented connection. Every move is a shared story entry—no scripts or automatic ledger changes.</p>
      </div>
      <button className="btn btn-red" onClick={()=>{clearEditor();setPanel("mine")}}>＋ Create a game</button>
    </div>
    <div className="community-tabs" role="group" aria-label="Game library views">
      <button className={panel==="explore"?"chosen":""} onClick={()=>setPanel("explore")}>✦ Discover games <span>{games.length}</span></button>
      <button className={panel==="mine"?"chosen":""} onClick={()=>setPanel("mine")}>◇ My creations <span>{mine.length}</span></button>
      <button className={panel==="sessions"?"chosen":""} onClick={()=>setPanel("sessions")}>▤ Shared sessions</button>
    </div>

    {panel==="explore" && <>
      <form className="search-row community-search" onSubmit={e=>{e.preventDefault();setSubmittedSearch(search.trim());if(search.trim()===submittedSearch)void loadLibrary(search.trim())}}>
        <input aria-label="Search community games" placeholder="Search games, categories, ideas…" value={search} maxLength={80} onChange={e=>setSearch(e.target.value)}/>
        <button className="btn btn-red">Explore library</button>
      </form>
      <div className="community-layout">
        <div className="game-catalog">
          {games.length===0?<div className="empty-inner">No published games match yet. Be the first to share one.</div>:
          games.map(game=><button key={game.id} className={"community-game-card "+(chosenGame===game.id?"chosen":"")}
            onClick={()=>setChosenGame(game.id)} aria-label={"View game "+game.title}>
            <div className="game-card-meta"><span>{game.category}</span><span>◇ {game.play_count} plays</span></div>
            <h3>{game.title}</h3><p>{game.summary}</p>
            <div className="game-author">by @{game.author_handle} <span>Read rules →</span></div>
          </button>)}
        </div>
        <aside className="dash-card game-inspector">
          {!selectedGame?<div className="inspector-empty"><div>✧</div><h3>Pick your next story</h3><p>Choose a published game to read its rules and invite your connected partner to play.</p></div>:<>
            <div className="eyebrow">COMMUNITY RULEBOOK · {selectedGame.category.toUpperCase()}</div>
            <h3>{selectedGame.title}</h3><p className="muted">{selectedGame.summary}</p>
            <h4>How to play</h4><div className="rule-copy">{selectedGame.rules}</div>
            {selectedGame.opening_prompt && <><h4>Opening prompt</h4><p className="rule-copy">{selectedGame.opening_prompt}</p></>}
            <label className="community-scene-label">PLAY WITH A CONNECTION
              <select aria-label="Play in connection" value={sceneChoice} onChange={e=>setSceneChoice(e.target.value)}>
                {scenes.length===0 && <option value="">No scenes yet</option>}
                {scenes.map(s=><option key={s.id} value={s.id}>@{s.other_handle} · {s.status}</option>)}
              </select>
            </label>
            <button className="btn btn-red full" disabled={working||!isActiveScene} onClick={()=>void start(selectedGame.id)}>Start with your partner ↗</button>
            {!isActiveScene && <p className="community-hint">An active approved scene is required. You can still browse and publish games.</p>}
            {selectedGame.author_id!==meId && <button className="btn btn-quiet report-game" disabled={working} onClick={()=>{
              const reason=window.prompt("Why are you reporting this game? (10–500 characters)")
              if(reason)void perform({action:"report",gameId:selectedGame.id,reason})
            }}>Report game</button>}
          </>}
        </aside>
      </div>
    </>}

    {panel==="mine" && <div className="community-layout">
      <div className="dash-card game-composer">
        <div className="eyebrow">YOUR IMAGINATION / YOUR RULES</div>
        <h3>{editing?"Edit your game":"Build a new game"}</h3>
        <p className="muted">Describe any kind of text-based game, challenge, or collaborative story. Your rules guide the players; both can write free-form turns.</p>
        <form className="form-stack" onSubmit={e=>{e.preventDefault();void save(true)}}>
          <label>GAME TITLE<input required minLength={3} maxLength={80} value={draft.title} placeholder="A secret at midnight" onChange={e=>setDraft({...draft,title:e.target.value})}/></label>
          <label>SHORT DESCRIPTION<input required minLength={10} maxLength={240} value={draft.summary} placeholder="What makes your game interesting?" onChange={e=>setDraft({...draft,summary:e.target.value})}/></label>
          <label>CATEGORY<input required minLength={3} maxLength={30} value={draft.category} placeholder="Story, mystery, strategy…" onChange={e=>setDraft({...draft,category:e.target.value})}/></label>
          <label>RULES AND HOW TO PLAY<textarea required minLength={20} maxLength={4000} rows={7} value={draft.rules} placeholder="How do players take turns? What choices can they make? How do they win or end the game?" onChange={e=>setDraft({...draft,rules:e.target.value})}/></label>
          <label>OPENING PROMPT (OPTIONAL)<textarea maxLength={1000} rows={3} value={draft.openingPrompt} placeholder="A starting situation or question for your partner…" onChange={e=>setDraft({...draft,openingPrompt:e.target.value})}/></label>
          <div className="composer-actions"><button className="btn btn-outline" type="button" disabled={working} onClick={()=>void save(false)}>Save draft</button><button className="btn btn-red" type="submit" disabled={working}>{editing?"Save & publish changes":"Publish to Discover ↗"}</button>{editing && <button className="btn btn-quiet" type="button" onClick={clearEditor}>Cancel editing</button>}</div>
        </form>
      </div>
      <div className="dash-card my-game-list">
        <h3>Your games <span className="mini-label">{mine.length}/50 CREATED</span></h3>
        {mine.length===0?<div className="empty-inner">Your first creation begins here.</div>:
          mine.map(game=><div className="my-game-row" key={game.id}>
            <div><b>{game.title}</b><small>{game.category} · {game.play_count} plays · {game.published?"Published":"Private draft"}</small></div>
            <div className="person-actions"><button className="btn btn-quiet" onClick={()=>openEditor(game)}>Edit</button>
              <button className="btn btn-outline" disabled={working} onClick={()=>void perform({action:"publish",gameId:game.id,publish:!game.published})}>{game.published?"Unpublish":"Publish"}</button></div>
          </div>)}
      </div>
    </div>}

    {panel==="sessions" && <div className="community-layout">
      <div className="dash-card session-list-card">
        <h3>Games with your partners</h3><p className="muted">Games run within approved scenes. Pausing a scene also pauses its games.</p>
        <label className="community-scene-label">CHOOSE CONNECTION
          <select aria-label="Game connection" value={sceneChoice} onChange={e=>setSceneChoice(e.target.value)}>
            {scenes.length===0 && <option value="">No scenes yet</option>}
            {scenes.map(s=><option key={s.id} value={s.id}>@{s.other_handle} · {s.status}</option>)}
          </select>
        </label>
        <button className="btn btn-quiet" disabled={!sceneChoice} onClick={()=>void loadSessions()}>↻ Refresh game list</button>
        {!sessions.length?<div className="empty-inner">No shared games here yet. Explore the library to start one.</div>:
          sessions.map(s=><button className={"session-list-item "+(sessionId===s.id?"chosen":"")} key={s.id} onClick={()=>setSessionId(s.id)}>
            <strong>{s.title_snapshot}</strong><small>Started by @{s.started_by_handle} · {s.state}</small>
          </button>)}
      </div>
      <div className="dash-card session-play-card">
        {!details || details.session.id!==sessionId?<div className="empty-inner">Choose a game to see its story.</div>:<>
          <span className="eyebrow">SHARED GAME / {details.session.state.toUpperCase()}</span>
          <h3>{details.session.title_snapshot}</h3>
          <div className="rule-copy session-rules">{details.session.rules_snapshot}</div>
          {details.session.prompt_snapshot && <div className="game-opening"><strong>Opening prompt</strong><p>{details.session.prompt_snapshot}</p></div>}
          <div className="section-title session-heading"><h2>Story turns</h2><span>{details.turns.length}/80 TURNS</span></div>
          <div className="game-turns" aria-label="Game turns">
            {!details.turns.length && <div className="empty-inner">Your story is ready. Make the opening move.</div>}
            {details.turns.map(t=><div key={t.id} className={"game-turn "+(t.actor_id===meId?"own":"")}>
              <div className="game-turn-header"><strong>@{t.actor_handle}</strong><small>{new Date(t.created_at).toLocaleString("en-GB")}</small></div>
              <p>{t.content}</p>
            </div>)}
          </div>
          {isOpen && isActiveScene && <form className="game-turn-form" onSubmit={e=>void submitTurn(e)}>
            <label>YOUR MOVE<textarea aria-label="Your game move" rows={3} maxLength={1200} placeholder="Describe what you do next, ask a question, set a challenge…" value={move} onChange={e=>setMove(e.target.value)}/></label>
            <button className="btn btn-red" disabled={working||!move.trim()} type="submit">Post move ↗</button>
          </form>}
          {isOpen && !isActiveScene && <p className="community-hint">This scene is paused or ended. No new turns can be added.</p>}
          <div className="session-actions"><button className="btn btn-outline" onClick={()=>void loadSession()}>↻ Refresh turns</button>
            {isOpen && <button className="btn btn-danger-soft" disabled={working} onClick={()=>{
              if(window.confirm("Finish this game? The turn history will remain readable."))void perform({action:"finish",sessionId},()=>{void loadSession(sessionId)})
            }}>Finish game</button>}</div>
        </>}
      </div>
    </div>}
  </section>
}
