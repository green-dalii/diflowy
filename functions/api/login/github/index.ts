import { generateState } from "arctic";
import { initializeGitHub } from "../../auth";
import type { Env } from "../../auth";
import type { PagesFunction, EventContext } from "@cloudflare/workers-types";

// import type { APIContext } from "astro";

// export async function GET(context: APIContext): Promise<Response> {
// 	const state = generateState();
//     const github = initializeGitHub(context.env.GITHUB_ID, context.env.GITHUB_SECRET);
// 	const url = await github.createAuthorizationURL(state);

// 	context.cookies.set("github_oauth_state", state, {
// 		path: "/",
// 		secure: true,
// 		httpOnly: true,
// 		maxAge: 60 * 10,
// 		sameSite: "lax"
// 	});

// 	return context.redirect(url.toString());
// }

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