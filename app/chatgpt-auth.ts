import {headers} from 'next/headers';
import {redirect} from 'next/navigation';
import {accessIdentity} from '@/lib/access-auth.mts';
export type ChatGPTUser={userId:string;displayName:string;email:string;fullName:string|null};

export async function getChatGPTUser():Promise<ChatGPTUser|null>{
  const requestHeaders=await headers();
  // Vercel does not provide ChatGPT Sites headers. Only a verified Access JWT works.
  return accessIdentity(requestHeaders.get('cf-access-jwt-assertion'));
}
export async function requireChatGPTUser(returnTo:string):Promise<ChatGPTUser>{
  const user=await getChatGPTUser();
  if(!user)redirect(chatGPTSignInPath(returnTo));
  return user;
}
export function chatGPTSignInPath(returnTo:string){
  const path=returnTo.startsWith('/')&&!returnTo.startsWith('//')?returnTo:'/';
  return '/signin-with-chatgpt?return_to='+encodeURIComponent(path);
}
export function chatGPTSignOutPath(){return '/signout-with-chatgpt';}
