// On Vercel, identity comes from a Cloudflare Access-protected custom domain.
export function GET(request:Request){
  const configured=process.env.JOSHBOX_PUBLIC_URL;
  if(!configured)return new Response('Private sign-in has not been configured.',{status:503});
  const url=new URL(configured);
  if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash||url.pathname!=='/')return new Response('Private sign-in is misconfigured.',{status:503});
  const requested=new URL(request.url).searchParams.get('return_to')||'/';
  const path=requested.startsWith('/')&&!requested.startsWith('//')&&!requested.includes('\\')?requested:'/';
  return Response.redirect(new URL(path,url),303);
}
