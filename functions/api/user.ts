import { jwtVerify } from 'jose';
import * as jose from 'jose'
import type { Env } from './auth';

export async function onRequest(context: { request: Request; env: Env }) {
    try {
        const { request } = context;
        const cookie = request.headers.get('cookie');
        const jwt = cookie?.split('; ').find((row: string) => row.startsWith('auth_token='))?.split('=')[1];
        console.log("User API JWT>>>", jwt)
        if (!jwt) {
            return new Response(JSON.stringify({ user: null }), {
                headers: { 'Content-Type': 'application/json' },
                status: 401,
            });
        }
        const { payload } = await jwtVerify(jwt, new TextEncoder().encode(context.env.AUTH_SECRET));
        console.log("User API Payload>>>", payload)
        return new Response(JSON.stringify({ user: payload }), {
            headers: { 'Content-Type': 'application/json' },
            status: 200,
        });
    } catch (error) {
        if (error instanceof jose.errors.JOSEError) {
            console.error("JWT Expired", error);
            return new Response(JSON.stringify({ user: null }), {
                headers: { 'Content-Type': 'application/json' },
                status: 401,
            });
        } else {
            return new Response(JSON.stringify({ user: null }), {
                headers: { 'Content-Type': 'application/json' },
                status: 500,
            });
        }
    }
}