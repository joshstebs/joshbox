// Cloudflare Access terminates the login session, not a local unauthenticated redirect.
export function GET(){
  const raw=process.env.JOSHBOX_PUBLIC_URL;
  if(!raw)return new Response('Private sign-out is not configured.',{status:503});
  try{const url=new URL(raw);if(url.protocol!=='https:')throw Error();return Response.redirect(new URL('/cdn-cgi/access/logout',url),303);}
  catch{return new Response('Private sign-out is misconfigured.',{status:503});}
}
