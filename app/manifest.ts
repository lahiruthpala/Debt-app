import type {MetadataRoute} from "next"
export default function manifest():MetadataRoute.Manifest{
  return {
    id:"/dashboard",name:"Velvet Ledger — Private Scene Studio",short_name:"Velvet Ledger",
    description:"Consent-first fictional contracts, shared story games and partner space.",
    start_url:"/dashboard",display:"standalone",scope:"/",
    background_color:"#0a0a0a",theme_color:"#221421",
    icons:[{src:"/icons/icon.svg",type:"image/svg+xml",sizes:"any",purpose:"any"}]
  }
}