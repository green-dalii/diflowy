import type { PagesFunction } from "@cloudflare/workers-types";
import { OAuth2RequestError } from "arctic";
import { generateIdFromEntropySize } from "lucia";
import { initializeGitHub, initializeLucia } from "../../auth";
import type { Env } from "../../auth";
import type { APIContext } from "astro";

interface GitHubUser {
	id: string;
	login: string;
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const github = initializeGitHub(context.env);
  const lucia = initializeLucia(context.env);

  const url = new URL(context.request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");

  const storedState = context.request.headers.get("Cookie")?.match(/github_oauth_state=([^;]+)/)?.[1] ?? null;

  if (!code || !state || !storedState || state !== storedState) {
    return new Response(null, { status: 400 });
  }

  try {
    const tokens = await github.validateAuthorizationCode(code);
    const githubUserResponse = await fetch("https://api.github.com/user", {
      headers: {
        Authorization: `Bearer ${tokens.accessToken}`
      }
    });
    const githubUser: GitHubUser = await githubUserResponse.json();

    // 使用 D1 数据库查询现有用户
    const { results } = await context.env.D1.prepare(
      "SELECT * FROM user WHERE github_id = ?"
    ).bind(githubUser.id).all();
    const existingUser = results[0];

    let userId: string;
    // 如果数据库中存在用户
    if (existingUser) {
      userId = existingUser.id;
    } 
    // 如果为新用户
    else {
      userId = generateIdFromEntropySize(10); // 生成新的用户 ID
      // 插入新用户
      await context.env.D1.prepare(
        "INSERT INTO user (id, github_id, username) VALUES (?, ?, ?)"
      ).bind(userId, githubUser.id, githubUser.login).run();
    }

    const session = await lucia.createSession(userId, {});
    const sessionCookie = lucia.createSessionCookie(session.id);

    return new Response(null, {
      status: 302,
      headers: {
        Location: "/",
        "Set-Cookie": sessionCookie.serialize()
      }
    });
  } catch (e) {
    if (e instanceof OAuth2RequestError) {
      return new Response(null, { status: 400 });
    }
    console.error(e);
    return new Response(null, { status: 500 });
  }
};

// export async function GET(context: APIContext): Promise<Response> {
// 	const code = context.url.searchParams.get("code");
// 	const state = context.url.searchParams.get("state");
// 	const storedState = context.cookies.get("github_oauth_state")?.value ?? null;
// 	if (!code || !state || !storedState || state !== storedState) {
// 		return new Response(null, {
// 			status: 400
// 		});
// 	}

// 	try {
//     const github = initializeGitHub(context.env);
// 		const tokens = await github.validateAuthorizationCode(code);
// 		const githubUserResponse = await fetch("https://api.github.com/user", {
// 			headers: {
// 				Authorization: `Bearer ${tokens.accessToken}`
// 			}
// 		});
// 		const githubUser: GitHubUser = await githubUserResponse.json();

// 		// Replace this with your own DB client.
// 		const existingUser = await db.table("user").where("github_id", "=", githubUser.id).get();

// 		if (existingUser) {
// 			const session = await lucia.createSession(existingUser.id, {});
// 			const sessionCookie = lucia.createSessionCookie(session.id);
// 			context.cookies.set(sessionCookie.name, sessionCookie.value, sessionCookie.attributes);
// 			return context.redirect("/");
// 		}

// 		const userId = generateIdFromEntropySize(10); // 16 characters long

// 		// Replace this with your own DB client.
// 		await db.table("user").insert({
// 			id: userId,
// 			github_id: githubUser.id,
// 			username: githubUser.login
// 		});

// 		const session = await lucia.createSession(userId, {});
// 		const sessionCookie = lucia.createSessionCookie(session.id);
// 		context.cookies.set(sessionCookie.name, sessionCookie.value, sessionCookie.attributes);
// 		return context.redirect("/");
// 	} catch (e) {
// 		// the specific error message depends on the provider
// 		if (e instanceof OAuth2RequestError) {
// 			// invalid code
// 			return new Response(null, {
// 				status: 400
// 			});
// 		}
// 		return new Response(null, {
// 			status: 500
// 		});
// 	}
// }



// export async function onRequest(context) {
//     const { request, env } = context;
//     const url = new URL(request.url);
  
//     // const adapter = new D1Adapter(env.D1, {
//     //   user: "user",
//     //   session: "session"
//     // });
  
//     // const lucia = new Lucia(adapter, {
//     //   sessionCookie: {
//     //     attributes: {
//     //       secure: true
//     //     }
//     //   }
//     // });
  
//     // const github = new GitHub(env.GITHUB_ID, env.GITHUB_SECRET);
  
//     if (url.pathname === "/api/login/github") {
//       const [url, state] = await github.createAuthorizationURL();
//       const stateCookie = serializeCookie("github_oauth_state", state, {
//         httpOnly: true,
//         secure: true,
//         path: "/",
//         maxAge: 60 * 60
//       });
//       return new Response(null, {
//         status: 302,
//         headers: {
//           Location: url.toString(),
//           "Set-Cookie": stateCookie
//         }
//       });
//     }
  
//     if (url.pathname === "/api/login/github/callback") {
//       const code = url.searchParams.get("code");
//       const state = url.searchParams.get("state");
//       const storedState = request.headers.get("Cookie")?.match(/github_oauth_state=([^;]+)/)?.[1];
  
//       if (!code || !state || !storedState || state !== storedState) {
//         return new Response("Invalid state", { status: 400 });
//       }
  
//       const { accessToken } = await github.validateAuthorizationCode(code);
//       const githubUser = await github.getUser(accessToken);
  
//       // 检查用户是否已存在，如果不存在则创建
//       const existingUser = await env.D1.prepare(
//         "SELECT * FROM user WHERE github_id = ?"
//       ).bind(githubUser.id).first();
  
//       let userId;
//       if (existingUser) {
//         userId = existingUser.id;
//       } else {
//         userId = crypto.randomUUID();
//         await env.D1.prepare(
//           "INSERT INTO user (id, github_id, username) VALUES (?, ?, ?)"
//         ).bind(userId, githubUser.id, githubUser.login).run();
//       }
  
//       const session = await lucia.createSession(userId, {});
//       const sessionCookie = lucia.createSessionCookie(session.id);
  
//       return new Response(null, {
//         status: 302,
//         headers: {
//           Location: "/",
//           "Set-Cookie": sessionCookie.serialize()
//         }
//       });
//     }
  
//     // 其他 API 路由...
  
//     return new Response("Not found", { status: 404 });
//   }