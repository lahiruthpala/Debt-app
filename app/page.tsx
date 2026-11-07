import Link from "next/link"

export default function Home() {
  return (
    <main className="landing">
      <nav className="nav">
        <Link href="/" className="brand"><span className="brand-symbol">◆</span> VELVET LEDGER <small>PRIVATE ROLEPLAY STUDIO</small></Link>
        <div className="nav-links"><Link href="/sandbox">Solo demo</Link><Link href="/login" className="btn btn-outline">Sign in</Link><Link href="/login?mode=signup" className="btn btn-red">Create account</Link></div>
      </nav>
      <div className="hero">
        <div className="hero-copy">
          <div className="eyebrow"><span className="live-dot" /> CONSENT-FIRST · 18+ · FICTIONAL</div>
          <h1>Make the <em>rules.</em><br/>Keep the <em>ledger.</em></h1>
          <p className="hero-desc">A private playground for Dom and sub partners to connect, negotiate fantasy debt scenes, track imaginary balances and play interactive challenges—together, by choice.</p>
          <div className="hero-actions">
            <Link className="btn btn-red btn-lg" href="/login?mode=signup">Enter the studio <span>↗</span></Link>
            <Link className="btn btn-outline btn-lg" href="/sandbox">Try solo simulator</Link>
          </div>
          <div className="hero-note">No payments processed. No enforceable debt. Leave a scene whenever you choose.</div>
        </div>
        <div className="preview">
          <div className="preview-head"><div className="preview-brand">◆ VELVET LEDGER</div><span className="tiny-status">SCENE ACTIVE</span></div>
          <div className="preview-label">FANTASY BALANCE</div>
          <div className="preview-number">250,000 <span>CR</span></div>
          <div className="preview-line"><span>Principal</span><b>250,000</b></div>
          <div className="preview-line"><span>Accrued interest</span><b>0</b></div>
          <div className="preview-line"><span>Penalties</span><b>0</b></div>
          <div className="preview-dots"><span/><span/><span/><span/><span/></div>
          <div className="preview-banner">TWO PEOPLE. ONE AGREED STORY. ZERO REAL-WORLD OBLIGATIONS.</div>
        </div>
      </div>
      <section className="feature-grid">
        <div className="feature"><span className="feature-no">01 / DISCOVER</span><h3>Find your counterpart</h3><p>Opt-in profiles, role-based search and invitations that must be accepted.</p></div>
        <div className="feature"><span className="feature-no">02 / NEGOTIATE</span><h3>Write the rules together</h3><p>Proposed terms activate only after the sub explicitly accepts. Pause or end instantly.</p></div>
        <div className="feature"><span className="feature-no">03 / PLAY</span><h3>Roll, complete, progress</h3><p>Track pretend credits, spin the odds with Debt Dice and complete shared challenge cards.</p></div>
      </section>
      <section className="disclaimer-bar"><strong>Roleplay, not finance.</strong> Every balance is imaginary and not legally binding. This service is for consenting adults only and does not transfer money, issue loans or establish obligations.</section>
      <footer className="site-footer">VELVET LEDGER <span>FANTASY ONLY · CONSENT IS ALWAYS REVOCABLE</span></footer>
    </main>
  )
}
