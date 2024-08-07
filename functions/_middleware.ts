import { initializeLucia } from "./api/auth";
import type { Env } from "./api/auth";
import type { EventContext } from "@cloudflare/workers-types";
// import type { AppData } from "./api/user";
import { SignJWT } from 'jose'; 



async function errorHandling(context: EventContext<Env, any, any>): Promise<Response> {
    try {
        return await context.next() as unknown as Response;
    } catch (err) {
        console.error(err);
        if (err instanceof Error) {
            return new Response(`${err.message}\n${err.stack}`, { status: 500 });
        }
        return new Response('An unknown error occurred', { status: 500 });
    }
}

async function authentication(context: EventContext<Env, any, any>): Promise<Response> {
    const { request } = context;
    const lucia = initializeLucia(context.env);

    const sessionId = request.headers.get("Cookie")?.match(new RegExp(`${lucia.sessionCookieName}=([^;]+);?`))?.[1] ?? null;

    if (!sessionId) {
        context.data.user = null;
        context.data.session = null;
        return context.next() as unknown as Response;
    }

    try {
        const { session, user } = await lucia.validateSession(sessionId);
        if (session && session.fresh) {
            const sessionCookie = lucia.createSessionCookie(session.id);
            context.data.user = user;
            context.data.session = session;
            // const response = await context.next() as unknown as Response;
            // response.headers.set("Set-Cookie", sessionCookie.serialize());
            // return response;
            // 生成 JWT
            const jwt = await new SignJWT({ userId: user.id })
                .setProtectedHeader({ alg: 'HS256' })
                .setIssuedAt()
                .setExpirationTime('1h')
                .sign(new TextEncoder().encode(context.env.AUTH_SECRET));
            console.log("Middleware JWT>>>", jwt)
            const response = await context.next() as unknown as Response;
            response.headers.set("Set-Cookie", sessionCookie.serialize());
            // 设置 JWT Cookie
            response.headers.append("Set-Cookie", `jwt=${jwt}; HttpOnly; Secure; Path=/; Max-Age=3600`);
            return response;
        }
        // 
        if (!session) {
            const sessionCookie = lucia.createBlankSessionCookie();
            context.data.user = null;
            context.data.session = null;
            const response = await context.next() as unknown as Response;
            response.headers.set("Set-Cookie", sessionCookie.serialize());
            return response;
        }
        context.data.user = user;
        context.data.session = session;
        return context.next() as unknown as Response;
    } catch (error) {
        console.error("Error validating session:", error);
        context.data.user = null;
        context.data.session = null;
        return context.next() as unknown as Response;
    }
}

export const onRequest = [errorHandling, authentication];