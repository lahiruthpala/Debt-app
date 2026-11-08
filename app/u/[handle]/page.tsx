"use client"
import {useParams} from "next/navigation"
import {ShowcaseViewer} from "@/app/dashboard/profile-showcase"

export default function MemberProfilePage(){
  const params=useParams<{handle:string}>()
  return <main className="member-page"><ShowcaseViewer handle={params?.handle||""}/></main>
}
