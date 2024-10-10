import { generateState, generateCodeVerifier } from "arctic";
import { initializeGoogle } from "../../auth";
import type { Env } from "../../auth";
import type { EventContext } from "@cloudflare/workers-types";

export const onRequestGet: (context: EventContext<Env, any, Record<string, unknown>>) => Promise<Response> = async (context) => {
  try {
    const google = initializeGoogle(context.env);
    const state = generateState();
    const codeVerifier = generateCodeVerifier();
    const googleAuthURL = await google.createAuthorizationURL(state, codeVerifier, {
      scopes: ["profile", "email"]
    });
    const requestUrl = new URL(context.request.url)
    const redirect = requestUrl.searchParams.get("redirect") || "/";

    const stateCookie = `google_oauth_state=${state}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600`;
    const codeVerifierCookie = `google_code_verifier=${codeVerifier}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600`;
    const redirectCookie = `auth_redirect=${encodeURIComponent(redirect)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600`;

    const response = new Response(null, {
      status: 302,
      headers: {
        Location: googleAuthURL.toString(),
      },
    });
    response.headers.append("Set-Cookie", stateCookie);
    response.headers.append("Set-Cookie", codeVerifierCookie);
    response.headers.append("Set-Cookie", redirectCookie);

    return response;
  } catch (error) {
    console.error("Error during Google OAuth:", error);
    return new Response("Internal Server Error", { status: 500 });
  }
};