'use client'

import { useState, useEffect } from 'react'

type LogEntry = {
  id: number
  text: string
  time: string
}

const INITIAL_PRINCIPAL = 250000
const WEEKLY_PAYMENT = 15000
const MONTHLY_INTEREST_RATE = 0.12
const LATE_FEE = 5000
const DAILY_PENALTY = 1000

export default function Home() {
  const [principal, setPrincipal] = useState(INITIAL_PRINCIPAL)
  const [interest, setInterest] = useState(0)
  const [penalties, setPenalties] = useState(0)
  const [weeksPassed, setWeeksPassed] = useState(0)
  const [log, setLog] = useState<LogEntry[]>([])
  const [lastPaymentWeek, setLastPaymentWeek] = useState(0)

  const totalOwed = principal + interest + penalties

  const addLog = (text: string) => {
    const entry: LogEntry = {
      id: Date.now(),
      text,
      time: new Date().toLocaleString('en-LK', {
        day: '2-digit',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
      }),
    }
    setLog((prev) => [entry, ...prev].slice(0, 30))
  }

  // Apply monthly interest every 4 weeks
  useEffect(() => {
    if (weeksPassed > 0 && weeksPassed % 4 === 0) {
      const interestAmount = Math.round(principal * MONTHLY_INTEREST_RATE)
      setInterest((prev) => prev + interestAmount)
      addLog(`Monthly interest applied: +LKR ${interestAmount.toLocaleString()}`)
    }
  }, [weeksPassed])

  const makePayment = () => {
    if (totalOwed <= 0) return

    let remaining = WEEKLY_PAYMENT
    let newPenalties = penalties
    let newInterest = interest
    let newPrincipal = principal

    // Pay penalties first
    if (newPenalties > 0) {
      const pay = Math.min(remaining, newPenalties)
      newPenalties -= pay
      remaining -= pay
    }

    // Then interest
    if (remaining > 0 && newInterest > 0) {
      const pay = Math.min(remaining, newInterest)
      newInterest -= pay
      remaining -= pay
    }

    // Then principal
    if (remaining > 0 && newPrincipal > 0) {
      const pay = Math.min(remaining, newPrincipal)
      newPrincipal -= pay
      remaining -= pay
    }

    setPenalties(newPenalties)
    setInterest(newInterest)
    setPrincipal(newPrincipal)
    setWeeksPassed((w) => w + 1)
    setLastPaymentWeek(weeksPassed + 1)

    addLog(`Weekly tribute of LKR ${WEEKLY_PAYMENT.toLocaleString()} received. Remaining debt: LKR ${(newPrincipal + newInterest + newPenalties).toLocaleString()}`)
  }

  const addLatePenalty = () => {
    setPenalties((p) => p + LATE_FEE)
    addLog(`Late payment penalty added: +LKR ${LATE_FEE.toLocaleString()}`)
  }

  const addDailyPenalty = () => {
    setPenalties((p) => p + DAILY_PENALTY)
    addLog(`Daily penalty applied: +LKR ${DAILY_PENALTY.toLocaleString()}`)
  }

  const increaseDebt = () => {
    const extra = 25000
    setPrincipal((p) => p + extra)
    addLog(`Creditor increased principal by LKR ${extra.toLocaleString()}`)
  }

  const reset = () => {
    setPrincipal(INITIAL_PRINCIPAL)
    setInterest(0)
    setPenalties(0)
    setWeeksPassed(0)
    setLastPaymentWeek(0)
    setLog([])
    addLog('Debt reset to original terms.')
  }

  return (
    <div className="container">
      <header>
        <h1>Debt Servitude Agreement</h1>
        <p>Madam Vidumini × Lahiru Jayathilake · Fantasy Instrument</p>
      </header>

      {/* Live Stats */}
      <div className="stats">
        <div className="stat">
          <div className="label">Principal</div>
          <div className="value">LKR {principal.toLocaleString()}</div>
        </div>
        <div className="stat">
          <div className="label">Accrued Interest</div>
          <div className="value">LKR {interest.toLocaleString()}</div>
        </div>
        <div className="stat">
          <div className="label">Penalties</div>
          <div className="value">LKR {penalties.toLocaleString()}</div>
        </div>
        <div className="stat">
          <div className="label">Total Owed</div>
          <div className="value gold">LKR {totalOwed.toLocaleString()}</div>
        </div>
      </div>

      {/* Controls */}
      <div className="card">
        <h2>Debt Controls</h2>
        <p style={{ color: '#888', fontSize: '0.85rem', marginBottom: '1rem' }}>
          Week {weeksPassed} · Minimum weekly tribute: LKR {WEEKLY_PAYMENT.toLocaleString()} · Interest 12% / month
        </p>
        <div className="actions">
          <button onClick={makePayment} disabled={totalOwed <= 0}>
            Make Weekly Payment
          </button>
          <button className="secondary" onClick={addLatePenalty}>
            Add Late Fee (+5,000)
          </button>
          <button className="secondary" onClick={addDailyPenalty}>
            Daily Penalty (+1,000)
          </button>
          <button className="secondary" onClick={increaseDebt}>
            Increase Debt (+25,000)
          </button>
          <button className="secondary" onClick={reset}>
            Reset
          </button>
        </div>
      </div>

      {/* Activity Log */}
      <div className="card">
        <h2>Activity Log</h2>
        <div className="log">
          {log.length === 0 && (
            <div className="log-entry">No activity yet. Begin servicing the debt.</div>
          )}
          {log.map((entry) => (
            <div key={entry.id} className="log-entry">
              <strong>{entry.time}</strong> — {entry.text}
            </div>
          ))}
        </div>
      </div>

      {/* Full Contract */}
      <div className="card">
        <h2>Financial Debt & Servitude Agreement</h2>
        <div className="contract-body">
          <p>
            <strong>THIS AGREEMENT</strong> is made between <strong>Madam Vidumini</strong> (the “Creditor”)
            and <strong>Lahiru Jayathilake</strong> of Negombo, Sri Lanka (the “Debtor”).
          </p>

          <h3>1. Acknowledgement of Debt</h3>
          <p>
            The Debtor irrevocably acknowledges that he is indebted to the Creditor in the principal sum of
            <strong> Sri Lankan Rupees Two Hundred and Fifty Thousand (LKR 250,000.00)</strong>.
          </p>

          <h3>2. Interest</h3>
          <p>
            The Principal Debt shall bear interest at the rate of <strong>12% per month</strong>, calculated
            on the outstanding balance and compounded monthly. Interest continues until the debt is fully
            discharged at the Creditor’s sole discretion.
          </p>

          <h3>3. Repayment Terms</h3>
          <ul>
            <li>Minimum weekly payment of <strong>LKR 15,000.00</strong> every Friday.</li>
            <li>Payments applied first to penalties, then interest, then principal.</li>
            <li>Creditor may increase the weekly amount or add further principal at any time.</li>
          </ul>

          <h3>4. Late Payment & Default</h3>
          <ul>
            <li>Late fee of <strong>LKR 5,000.00</strong> if payment is not received on the due date.</li>
            <li>Additional <strong>LKR 1,000.00 per day</strong> while payment remains outstanding.</li>
            <li>Two consecutive missed payments = Event of Default. Full balance becomes immediately due.</li>
          </ul>

          <h3>5. Additional Obligations</h3>
          <ul>
            <li>Debtor shall produce income and expenditure records upon request.</li>
            <li>No new significant financial commitments without prior consent of the Creditor.</li>
            <li>Failure to comply with any protocol may result in further sums being added to the debt.</li>
          </ul>

          <h3>6. Nature of the Debt</h3>
          <p>
            The Debtor acknowledges that this debt is permanent in nature unless and until the Creditor
            issues a written discharge. The Debtor waives any right to unilaterally terminate this Agreement.
          </p>

          <h3>7. Governing Framework</h3>
          <p>
            This Agreement is entered into solely for private consensual roleplay and fantasy purposes.
            It creates <strong>no legal rights or obligations</strong> enforceable in any court of law
            in Sri Lanka or elsewhere.
          </p>

          <div className="signature-block">
            <div className="signature">
              <div className="name">Madam Vidumini</div>
              <div className="role">Creditor / Goddess</div>
            </div>
            <div className="signature">
              <div className="name">Lahiru Jayathilake</div>
              <div className="role">Debtor / Slave</div>
            </div>
          </div>
        </div>
      </div>

      <div className="disclaimer">
        This is a fantasy roleplay instrument only. It is not a legally binding contract, promissory note,
        or enforceable debt under the laws of Sri Lanka or any other jurisdiction.
      </div>
    </div>
  )
}
