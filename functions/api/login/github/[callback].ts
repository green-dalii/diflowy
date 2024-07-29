import type { PagesFunction, EventContext } from "@cloudflare/workers-types";
import { OAuth2RequestError } from "arctic";
import { generateIdFromEntropySize } from "lucia";
import { initializeGitHub, initializeLucia } from "../../auth";
import type { Env } from "../../auth";

interface GitHubUser {
	id: string;
	login: string;
}

export const onRequestGet: (context: EventContext<Env, any, Record<string, unknown>>) => Promise<Response>  = async (context): Promise<Response> => {
  const github = initializeGitHub(context.env);
  const lucia = initializeLucia(context.env);

  const url = new URL(context.request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");

  const storedState = context.request.headers.get("Cookie")?.match(/github_oauth_state=([^;]+)/)?.[1] ?? null;

  if (!code || !state || !storedState || state !== storedState) {
    return new Response("Invalid request parameters", { status: 400 });
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
      userId = existingUser.id as string;
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
      return new Response("OAuth2 Request Error", { status: 400 });
    }
    console.error(e);
    return new Response("Internal Server Error", { status: 500 });
  }
};
