export type QuickGameKey="coin"|"highlow"|"cards"|"vault"
export type QuickResult={label:string;delta:number;detail:string}
export const quickGameKeys=["coin","highlow","cards","vault"] as const

/** A fixed, auditable set of server-resolved games; all credits are imaginary. */
export function resolveQuickGame(game:QuickGameKey,choice:string,draw:number):QuickResult {
  if(!Number.isInteger(draw)||draw<0||draw>=6)throw new Error("Invalid random draw")
  if(game==="coin"){
    if(choice!=="heads"&&choice!=="tails")throw new Error("Choose heads or tails")
    const landed=draw%2===0?"heads":"tails"
    const won=choice===landed
    return {label:`Coin landed ${landed}`,delta:won?-1000:500,detail:won?"Correct call":"Missed call"}
  }
  if(game==="highlow"){
    if(choice!=="high"&&choice!=="low")throw new Error("Choose high or low")
    const rolled=draw+1
    const won=choice===(rolled>=4?"high":"low")
    return {label:`Die showed ${rolled}`,delta:won?-1250:600,detail:won?"Correct prediction":"Incorrect prediction"}
  }
  if(game==="cards"){
    if(choice!=="draw")throw new Error("Draw a card")
    const cards=[
      {label:"Golden card",delta:-2000},
      {label:"Silver card",delta:-1000},
      {label:"Kindness card",delta:-500},
      {label:"Blank card",delta:0},
      {label:"Twist card",delta:500},
      {label:"House card",delta:1000},
    ]
    return {...cards[draw],detail:"A randomly drawn card"}
  }
  if(choice!=="1"&&choice!=="2"&&choice!=="3")throw new Error("Choose vault 1, 2 or 3")
  const vault=(draw%3)+1
  const won=Number(choice)===vault
  return {label:`Treasure was behind vault ${vault}`,delta:won?-1800:350,detail:won?"Found the treasure":"Empty vault"}
}
