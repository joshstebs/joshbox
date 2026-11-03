/** Verify Cloudflare Access identity cryptographically; never trust bare email headers. */
import {createRemoteJWKSet,jwtVerify,type JWTVerifyGetKey} from 'jose';
type Settings={CF_ACCESS_TEAM_DOMAIN?:string;CF_ACCESS_AUD?:string;JOSHBOX_OWNER_EMAIL?:string;JOSHBOX_OWNER_ID?:string};
const keys=new Map<string,JWTVerifyGetKey>();
export async function accessIdentity(token:string|null,settings:Settings=process.env){
  if(!token||token.length>16000||!settings.CF_ACCESS_TEAM_DOMAIN||!settings.CF_ACCESS_AUD||!settings.JOSHBOX_OWNER_EMAIL)return null;
  try{
    const issuer=new URL(settings.CF_ACCESS_TEAM_DOMAIN);
    if(issuer.protocol!=='https:'||!issuer.hostname.endsWith('.cloudflareaccess.com')||issuer.username||issuer.password||issuer.port||issuer.search||issuer.hash||issuer.pathname!=='/')return null;
    if(!keys.has(issuer.origin))keys.set(issuer.origin,createRemoteJWKSet(new URL('/cdn-cgi/access/certs',issuer.origin)));
    const {payload}=await jwtVerify(token,keys.get(issuer.origin)!,{issuer:issuer.origin,audience:settings.CF_ACCESS_AUD,algorithms:['RS256'],requiredClaims:['exp','iat','sub','email']});
    const email=typeof payload.email==='string'?payload.email.toLowerCase():'';
    if(!email||email!==settings.JOSHBOX_OWNER_EMAIL.toLowerCase()||typeof payload.sub!=='string')return null;
    return {userId:settings.JOSHBOX_OWNER_ID||'access:'+payload.sub,email,displayName:email,fullName:null};
  }catch{return null;}
}
