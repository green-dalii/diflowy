import { generateState } from "arctic";
import { initializeGitHub } from "../../auth";
import type { Env } from "../../auth";
import type { EventContext } from "@cloudflare/workers-types";

//Creating authorization URL
export const onRequestGet: (context: EventContext<Env, any, Record<string, unknown>>) => Promise<Response> = async (context) => {
    const github = initializeGitHub(context.env);
    const state = generateState();
    const githubAuthURL = await github.createAuthorizationURL(state);
    const requestUrl = new URL(context.request.url)
    const redirect = requestUrl.searchParams.get("redirect") || "/";
    // console.log("AuthorizationURL>>>>", url)
    console.log("Login/Github redirect>>>", redirect)

    const stateCookie = `github_oauth_state=${state}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600`;
    const redirectCookie = `auth_redirect=${encodeURIComponent(redirect)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600`;
    console.log("redirectCookie>>>", redirectCookie)
    // 创建用于设置 cookie 的 Response 对象
    const response = new Response(null, {
      status: 302,
      headers: {
        Location: githubAuthURL.toString(),
        "Set-Cookie": [stateCookie, redirectCookie].join(", "),
      },
    });
  
    return response;
  };