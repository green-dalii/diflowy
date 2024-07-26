import { github, initializeLucia } from "../../../auth";
import { OAuth2RequestError } from "arctic";
import { generateIdFromEntropySize } from "lucia";


import type { APIContext } from "astro";

// const D1_DATABASE = D1("D1");
const lucia = initializeLucia(env.D1);

/**
 * GET 方法，用于处理 GitHub OAuth 回调请求
 * 通过用户提供的 code 和 state 参数，交换访问令牌，并创建或检索用户数据
 * 然后，创建一个新的会话并设置相应的 Cookie，最后重定向用户到根路径
 * 或根据错误情况返回适当的响应
 * @param context - APIContext 对象，包含了请求和响应的相关信息
 * @return 一个 Promise，解析为 Response 对象，表示处理结果
 */
export async function GET(context: APIContext): Promise<Response> {
	const code = context.url.searchParams.get("code");
	const state = context.url.searchParams.get("state");
	const storedState = context.cookies.get("github_oauth_state")?.value ?? null;
	if (!code || !state || !storedState || state !== storedState) {
		return new Response(null, {
			status: 400
		});
	}

	try {
		const tokens = await github.validateAuthorizationCode(code);
		const githubUserResponse = await fetch("https://api.github.com/user", {
			headers: {
				Authorization: `Bearer ${tokens.accessToken}`
			}
		});
		const githubUser: GitHubUser = await githubUserResponse.json();

		// Replace this with your own DB client.
		const existingUser = await db.table("user").where("github_id", "=", githubUser.id).get();

		if (existingUser) {
			const session = await lucia.createSession(existingUser.id, {});
			const sessionCookie = lucia.createSessionCookie(session.id);
			context.cookies.set(sessionCookie.name, sessionCookie.value, sessionCookie.attributes);
			return context.redirect("/");
		}

		const userId = generateIdFromEntropySize(10); // 16 characters long

		// Replace this with your own DB client.
		await db.table("user").insert({
			id: userId,
			github_id: githubUser.id,
			username: githubUser.login
		});

		const session = await lucia.createSession(userId, {});
		const sessionCookie = lucia.createSessionCookie(session.id);
		context.cookies.set(sessionCookie.name, sessionCookie.value, sessionCookie.attributes);
		return context.redirect("/");
	} catch (e) {
		// the specific error message depends on the provider
		if (e instanceof OAuth2RequestError) {
			// invalid code
			return new Response(null, {
				status: 400
			});
		}
		return new Response(null, {
			status: 500
		});
	}
}

interface GitHubUser {
    id: string;
    login: string;
  }
  
  // D1 数据库操作函数
  async function getUserByGitHubId(githubId: string): Promise<User | null> {
    const user = await D1_DATABASE.prepare("SELECT * FROM users WHERE github_id = ?")
      .bind(githubId)
      .first();
    return user ? mapRowToUser(user) : null;
  }
  
  async function createUserInDB(userId: string, githubId: string, username: string): Promise<void> {
    await D1_DATABASE.prepare("INSERT INTO users (id, github_id, username) VALUES (?, ?, ?)")
      .bind(userId, githubId, username)
      .run();
  }
  
  // 用户映射函数
  function mapRowToUser(row: any): User {
    return {
      id: row.id,
      githubId: row.github_id,
      username: row.username
    };
  }
  
  interface User {
    id: string;
    githubId: string;
    username: string;
  }