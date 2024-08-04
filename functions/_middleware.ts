import { initializeLucia } from "./api/auth";
import type { Env } from "./api/auth";

async function errorHandling(context) {
  try {
    return await context.next();
  } catch (err) {
    console.error(err);
    return new Response(`${err.message}\n${err.stack}`, { status: 500 });
  }
}

async function authentication(context) {
  const { request } = context;
  const lucia = initializeLucia(context.env);

  const sessionId = request.headers.get("Cookie")?.match(new RegExp(`${lucia.sessionCookieName}=([^;]+);?`))?.[1] ?? null;

  if (!sessionId) {
    context.locals.user = null;
    context.locals.session = null;
    return context.next();
  }

  try {
    const { session, user } = await lucia.validateSession(sessionId);
    if (session && session.fresh) {
      const sessionCookie = lucia.createSessionCookie(session.id);
      context.cookies.set(sessionCookie.name, sessionCookie.value, sessionCookie.attributes);
    }
    if (!session) {
      const sessionCookie = lucia.createBlankSessionCookie();
      context.cookies.set(sessionCookie.name, sessionCookie.value, sessionCookie.attributes);
    }
    context.locals.user = user;
    context.locals.session = session;
    return context.next();
  } catch (error) {
    console.error("Error validating session:", error);
    context.locals.user = null;
    context.locals.session = null;
    return context.next();
  }
}

export const onRequest = [errorHandling, authentication];