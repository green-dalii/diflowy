import type { EventContext } from "@cloudflare/workers-types";
import { OAuth2RequestError } from "arctic";
import { generateIdFromEntropySize } from "lucia";
import { initializeGitHub } from "../auth";
import type { Env } from "../auth";
import { createJWT } from "../../jwtUtils";

interface GitHubUser {
  id: string;
  login: string;
}

export const onRequestGet: (context: EventContext<Env, any, Record<string, unknown>>) => Promise<Response> = async (context): Promise<Response> => {
  try {
    const github = initializeGitHub(context.env);
    // const lucia = initializeLucia(context.env);

    const url = new URL(context.request.url);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    // console.log("GET Request>>>URL>>>", url, "code>>>", code, "state>>>", state)

    const storedState = context.request.headers.get("Cookie")?.match(/github_oauth_state=([^;]+)/)?.[1] ?? null;
    const redirectCookie = context.request.headers.get("Cookie")?.match(/auth_redirect=([^;]+)/)?.[1] ?? null;
    const redirectUrl = redirectCookie ? decodeURIComponent(redirectCookie) : "/";
    console.log("redirect cookie>>>", redirectCookie, "redirectUrl>>>", redirectUrl)

    if (!code || !state || !storedState || state !== storedState) {
      console.log("Invalid request parameters")
      return new Response("Invalid request parameters", { status: 400 });
    }
    const tokens = await github.validateAuthorizationCode(code);
    const githubUserResponse = await fetch("https://api.github.com/user", {
      headers: {
        "Authorization": `Bearer ${tokens.accessToken}`,
        "User-Agent": "diflowy",
      }
    });
    const githubUser: GitHubUser = await githubUserResponse.json();

    // 使用 D1 数据库查询现有用户
    const { results } = await context.env.D1.prepare(
      "SELECT * FROM users WHERE github_id = ?"
    ).bind(githubUser.id).all();
    const existingUser = results[0];

    let userId: string;
    // 如果数据库中存在用户
    if (existingUser) {
      console.log("User exists>>>", existingUser)
      userId = existingUser.id as string;
    }
    // 如果为新用户
    else {
      console.log("User does not exist")
      userId = generateIdFromEntropySize(10); // 生成新的用户 ID
      console.log("New User ID>>>", userId, "Prepare to write to database...")
      // 插入新用户
      await context.env.D1.prepare(
        "INSERT INTO users (id, github_id, username) VALUES (?, ?, ?)"
      ).bind(userId, githubUser.id, githubUser.login).run();
      console.log("New User created")
    }

    // 创建 JWT
    const token = await createJWT({ id: userId, username: githubUser.login }, context.env.AUTH_SECRET);
    // 设置响应头
    const cookie = `auth_token=${token}; HttpOnly; Secure; Path=/; Max-Age=3600`;
    return new Response(null, {
      status: 302,
      headers: {
        Location: redirectUrl,
        "Set-Cookie": cookie
      }
    });
  } catch (e) {
    console.error("Error in GitHub OAuth2 callback:", e);
    if (e instanceof OAuth2RequestError) {
      return new Response("OAuth2 Request Error", { status: 400 });
    }
    return new Response("Internal Server Error", { status: 500 });
  }
};
