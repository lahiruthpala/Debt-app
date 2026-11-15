import Link from "next/link"
export const dynamic="force-static"
export default function Offline(){
  return <main className="guest-screen"><span className="eyebrow">OFFLINE / PRIVATE BY DESIGN</span>
    <h1>Your scene is temporarily offline.</h1>
    <p>Online access is required to see private partner messages, approve agreements, change fictional balances or submit evidence.
       If you explicitly saved a local story draft on this device, reopen Story games once connected.</p>
    <Link href="/dashboard" className="btn btn-red">Try reconnecting</Link></main>
}