import type { EventContext } from "@cloudflare/workers-types";
import { OAuth2RequestError } from "arctic";
import { generateIdFromEntropySize } from "lucia";
import { initializeGitHub, initializeGoogle } from "../auth";
import type { Env } from "../auth";
import { createJWT } from "../../jwtUtils";

interface GitHubUser {
  id: string;
  login: string;
}

interface GoogleUser {
  id: string;
  email: string;
  name: string;
}

interface JWTPayload {
  [key: string]: any;
}

interface UserJWTPayload extends JWTPayload {
  id: string;
  username: string;
  provider: 'github' | 'google';
  providerId: string;
}

export const onRequestGet: (context: EventContext<Env, any, Record<string, unknown>>) => Promise<Response> = async (context): Promise<Response> => {
  try {
    // const lucia = initializeLucia(context.env);

    const url = new URL(context.request.url);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const provider = url.pathname.includes("github") ? "github" : "google";
    // console.log("GET Request>>>URL>>>", url, "code>>>", code, "state>>>", state)

    // const storedState = context.request.headers.get("Cookie")?.match(/github_oauth_state=([^;]+)/)?.[1] ?? null;
    const storedState = context.request.headers.get("Cookie")?.match(new RegExp(`${provider}_oauth_state=([^;]+)`))?.[1] ?? null;
    const redirectCookie = context.request.headers.get("Cookie")?.match(/auth_redirect=([^;]+)/)?.[1] ?? null;
    const redirectUrl = redirectCookie ? decodeURIComponent(redirectCookie) : "/";
    const cookies = context.request.headers.get("Cookie") || "";
    const getCookieValue = (name: string) => cookies.match(new RegExp(`${name}=([^;]+)`))?.[1] ?? null;
    const storedCodeVerifier = getCookieValue(`${provider}_code_verifier`);

    console.log("Provider>>>", provider, "redirect cookie>>>", redirectCookie, "redirectUrl>>>", redirectUrl, "storedCodeVerifier>>>", storedCodeVerifier, "storedState>>>", storedState)

    if (!code || !state || !storedState || state !== storedState) {
      console.log("Invalid request parameters")
      return new Response("Invalid request parameters", { status: 400 });
    }

    let userPayload: UserJWTPayload;

    // 当OAuth认证为Github时
    if (provider === "github") {
      const github = initializeGitHub(context.env);
      try {
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

        // 如果数据库中存在用户
        if (existingUser) {
          console.log("Github User exists>>>", existingUser.id, "Username>>>", githubUser.login)
          // userId = existingUser.id as string;
          // userName = existingUser.username as string;
          userPayload = {
            id: existingUser.id as string,
            username: existingUser.username as string,
            provider: 'github',
            providerId: githubUser.id.toString()
          };
        }
        // 如果为新用户
        else {
          console.log("User does not exist")
          const userId = generateIdFromEntropySize(10); // 生成新的用户 ID
          console.log("New User ID>>>", userId, "Prepare to write to database...")
          // 插入新用户
          await context.env.D1.prepare(
            "INSERT INTO users (id, github_id, username) VALUES (?, ?, ?)"
          ).bind(userId, githubUser.id, githubUser.login).run();
          userPayload = {
            id: userId,
            username: githubUser.login,
            provider: 'github',
            providerId: githubUser.id.toString()
          };
          console.log("New User created")
        }
      } catch (e) {
        if (e instanceof OAuth2RequestError) {
          console.error("GitHub OAuth2 Request Error:", e.message, e.description);
          return new Response("GitHub OAuth2 Request Error", { status: 400 });
        }
        throw e;
      }
    } 
    // 当OAuth认证为Google时
    else if (provider === "google") {
      console.log("OAuth from  Google...")
      const google = initializeGoogle(context.env);
      if (!storedCodeVerifier) {
        return new Response("Missing code verifier", { status: 400 });
      }
      try {
        const tokens = await google.validateAuthorizationCode(code, storedCodeVerifier);
        console.log("token from  Google>>>", tokens)
        const googleUserResponse = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
          headers: {
            "Authorization": `Bearer ${tokens.accessToken}`
          }
        });
        console.log("googleUserResponse>>>", googleUserResponse)
        const googleUser: GoogleUser = await googleUserResponse.json();

        const { results } = await context.env.D1.prepare(
          "SELECT * FROM users WHERE google_id = ?"
        ).bind(googleUser.id).all();
        const existingUser = results[0];

        if (existingUser) {
          console.log("Google User exists>>>", existingUser.id, "Username>>>", googleUser.name)
          userPayload = {
            id: existingUser.id as string,
            username: existingUser.username as string,
            provider: 'google',
            providerId: googleUser.id
          };
        } else {
          console.log("User does not exist")
          const userId = generateIdFromEntropySize(10);
          console.log("New User ID>>>", userId, "Prepare to write to database...")
          userPayload = {
            id: userId,
            username: googleUser.name || googleUser.email.split("@")[0],
            provider: 'google',
            providerId: googleUser.id
          };
          await context.env.D1.prepare(
            "INSERT INTO users (id, google_id, username, email) VALUES (?, ?, ?, ?)"
          ).bind(userId, googleUser.id, userPayload.username, googleUser.email).run();
          console.log("New User created")
        }
      } catch (e) {
        if (e instanceof OAuth2RequestError) {
          console.error("Google OAuth2 Request Error:", e.message, e.description);
          return new Response("Google OAuth2 Request Error", { status: 400 });
        }
        throw e;
      }
    } else {
      return new Response("Unsupported OAuth provider", { status: 400 });
    }

    // 创建 JWT
    const token = await createJWT(userPayload, context.env.AUTH_SECRET);
    // 设置响应头
    const cookie = `auth_token=${token}; HttpOnly; Secure; Path=/; Max-Age=3600`;
    const response = new Response(null, {
      status: 302,
      headers: {
        Location: redirectUrl,
        "Set-Cookie": cookie
      }
    });

    // Clear OAuth-related cookies
    response.headers.append("Set-Cookie", `${provider}_oauth_state=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`);
    response.headers.append("Set-Cookie", `${provider}_code_verifier=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`);
    response.headers.append("Set-Cookie", "auth_redirect=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0");

    return response;
  } catch (e) {
    console.error("Error in GitHub OAuth2 callback:", e);
    if (e instanceof OAuth2RequestError) {
      return new Response("OAuth2 Request Error", { status: 400 });
    }
    return new Response("Internal Server Error", { status: 500 });
  }
};
