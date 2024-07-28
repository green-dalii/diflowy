import { Lucia } from "lucia";
import { D1Adapter } from "@lucia-auth/adapter-sqlite";
import { D1Database } from "@cloudflare/workers-types";
import { GitHub } from "arctic";

export const github = new GitHub(
	env.GITHUB_ID,
	env.GITHUB_SECRET
);


export function initializeLucia(D1: D1Database) {
	const adapter = new D1Adapter(D1, {
		user: "user",
		session: "session"
	});

	const lucia = new Lucia(adapter, {
        sessionCookie: {
          attributes: {
            secure: env.AUTH_SECRET
          }
        },
        getUserAttributes: (attributes) => {
          return {
            // attributes has the type of DatabaseUserAttributes
            githubId: attributes.github_id,
            username: attributes.username
          };
        }
      });
    
      return lucia;
}

// 定义用户属性接口
interface DatabaseUserAttributes {
	github_id: number;
	username: string;
}

// 声明Lucia模块
declare module "lucia" {
    interface Register {
      Lucia: ReturnType<typeof initializeLucia>;
      DatabaseUserAttributes: DatabaseUserAttributes;
    }
  }


export async function onRequest(context) {
    const { request, env } = context;
    const url = new URL(request.url);
  
    const adapter = new D1Adapter(env.D1, {
      user: "user",
      session: "session"
    });
  
    const lucia = new Lucia(adapter, {
      sessionCookie: {
        attributes: {
          secure: true
        }
      }
    });
  
    const github = new GitHub(env.GITHUB_ID, env.GITHUB_SECRET);
  
    if (url.pathname === "/api/login/github") {
      const [url, state] = await github.createAuthorizationURL();
      const stateCookie = serializeCookie("github_oauth_state", state, {
        httpOnly: true,
        secure: true,
        path: "/",
        maxAge: 60 * 60
      });
      return new Response(null, {
        status: 302,
        headers: {
          Location: url.toString(),
          "Set-Cookie": stateCookie
        }
      });
    }
  
    if (url.pathname === "/api/login/github/callback") {
      const code = url.searchParams.get("code");
      const state = url.searchParams.get("state");
      const storedState = request.headers.get("Cookie")?.match(/github_oauth_state=([^;]+)/)?.[1];
  
      if (!code || !state || !storedState || state !== storedState) {
        return new Response("Invalid state", { status: 400 });
      }
  
      const { accessToken } = await github.validateAuthorizationCode(code);
      const githubUser = await github.getUser(accessToken);
  
      // 检查用户是否已存在，如果不存在则创建
      const existingUser = await env.D1.prepare(
        "SELECT * FROM user WHERE github_id = ?"
      ).bind(githubUser.id).first();
  
      let userId;
      if (existingUser) {
        userId = existingUser.id;
      } else {
        userId = crypto.randomUUID();
        await env.D1.prepare(
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
    }
  
    // 其他 API 路由...
  
    return new Response("Not found", { status: 404 });
  }