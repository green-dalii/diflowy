import { generateState } from "arctic";
import { initializeGitHub } from "../../auth";
import type { Env } from "../../auth";
import type { EventContext } from "@cloudflare/workers-types";

//Creating authorization URL
export const onRequestGet: (context: EventContext<Env, any, Record<string, unknown>>) => Promise<Response> = async (context) => {
    const github = initializeGitHub(context.env);
    const state = generateState();
    const url = await github.createAuthorizationURL(state);
    // console.log("AuthorizationURL>>>>", url)
  
    // 创建用于设置 cookie 的 Response 对象
    const response = new Response(null, {
      status: 302,
      headers: {
        Location: url.toString(),
        "Set-Cookie": `github_oauth_state=${state}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600`
      },
    });
  
    return response;
  };