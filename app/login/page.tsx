"use client"
import Link from "next/link"
import { FormEvent, useState, useEffect } from "react"
import { useSearchParams } from "next/navigation"
import { Suspense } from "react"
import { authClient } from "@/lib/auth-client"

function LoginForm() {
  const params = useSearchParams()
  const [mode,setMode] = useState<"login" | "signup">(params.get("mode") === "signup" ? "signup" : "login")
  const [email,setEmail] = useState("")
  const [password,setPassword] = useState("")
  const [handle,setHandle] = useState("")
  const [role,setRole] = useState<"dom" | "sub">("sub")
  const [adult,setAdult] = useState(false)
  const [busy,setBusy] = useState(false)
  const [error,setError] = useState("")
  const [health,setHealth] = useState<string | null>(null)
  useEffect(() => {
    let cancelled = false
    fetch("/api/health", { cache: "no-store" })
      .then(async response => {
        const data = await response.json().catch(() => ({}))
        if (!cancelled && !response.ok) {
          setHealth(data.message || "Accounts are temporarily unavailable.")
        }
      })
      .catch(() => {
        if (!cancelled) setHealth("Cannot reach the account service.")
      })
    return () => { cancelled = true }
  }, [])
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); setError("")
    if (mode==="signup" && !adult) { setError("You must confirm you are at least 18 years old."); return }
    setBusy(true)
    try {
      if (health) throw new Error(health)
      if (mode === "signup") {
        if (!/^[a-zA-Z0-9_]{3,24}$/.test(handle)) throw new Error("Handle must be 3–24 letters, numbers or underscores")
        const result = await authClient.signUp.email({ email, password, name: handle })
        if (result.error) throw new Error(result.error.message || "Could not create account")
        sessionStorage.setItem("vl_signup_handle", handle)
        sessionStorage.setItem("vl_signup_role", role)
      } else {
        const result = await authClient.signIn.email({ email, password })
        if (result.error) throw new Error(result.error.message || "Could not sign in")
      }
      window.location.assign("/dashboard")
    } catch(err) { setError(err instanceof Error ? err.message : "Authentication failed") }
    finally { setBusy(false) }
  }
  return <div className="auth-wrap">
    <Link className="back-link" href="/">← Return to homepage</Link>
    <div className="auth-card">
      <div className="eyebrow">◆ PRIVATE STUDIO · 18+ ONLY</div>
      <h1>{mode === "signup" ? "Enter the story." : "Welcome back."}</h1>
      <p className="muted">{mode === "signup" ? "Create an identity for consensual, fictional play." : "Sign in to your private ledger."}</p>
      <div className="segmented">
        <button className={mode === "login" ? "selected" : ""} onClick={() => {setMode("login");setError("")}}>Sign in</button>
        <button className={mode === "signup" ? "selected" : ""} onClick={() => {setMode("signup");setError("")}}>Create account</button>
      </div>
      <form onSubmit={submit} className="form-stack">
        {mode === "signup" && <>
          <label>PUBLIC HANDLE<input required value={handle} maxLength={24} onChange={e=>setHandle(e.target.value)} placeholder="night_owl" autoComplete="nickname" /></label>
          <div className="form-label">YOUR ROLE</div>
          <div className="role-choices">
            <button type="button" className={role==="dom" ? "role selected" : "role"} onClick={()=>setRole("dom")}><b>DOM</b><span>Guide & propose scenes</span></button>
            <button type="button" className={role==="sub" ? "role selected" : "role"} onClick={()=>setRole("sub")}><b>SUB</b><span>Accept & participate</span></button>
          </div>
        </>}
        <label>EMAIL<input type="email" required autoComplete="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="you@example.com" /></label>
        <label>PASSWORD<input type="password" required minLength={mode==="signup" ? 10 : 1} autoComplete={mode==="signup" ? "new-password":"current-password"} value={password} onChange={e=>setPassword(e.target.value)} placeholder={mode==="signup" ? "At least 10 characters":"Your password"} /></label>
        {mode==="signup" && <label className="check-label"><input type="checkbox" checked={adult} onChange={e=>setAdult(e.target.checked)} /><span>I am 18 or older. I understand this platform is consensual roleplay only; I may withdraw consent at any time.</span></label>}
        {health && <p className="error" role="alert">{health}</p>}
      {error && <p className="error" role="alert">{error}</p>}
        <button className="btn btn-red btn-lg full" type="submit" disabled={busy}>{busy ? "Working..." : mode === "signup" ? "Create my account" : "Sign in"} <span>↗</span></button>
      </form>
      <p className="auth-foot">Private handles only. Email is never listed in discovery.<br/>No money or legally enforceable debt is involved.</p>
    </div>
  </div>
}
export default function LoginPage() {
  return <Suspense fallback={<div className="auth-wrap">Loading...</div>}><LoginForm/></Suspense>
}
