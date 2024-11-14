import { jwtVerify } from 'jose';
import * as jose from 'jose'
import type { Env } from '../auth';

export async function onRequest(context: { request: Request; env: Env }) {
    try {
        const { request } = context;
        // get cookie
        const cookie = request.headers.get('cookie');
        const jwt = cookie?.split('; ').find((row: string) => row.startsWith('auth_token='))?.split('=')[1];
        // console.log("User API JWT>>>", jwt)
        if (!jwt) {
            return new Response(JSON.stringify({ user: null }), {
                headers: { 'Content-Type': 'application/json' },
                status: 401,
            });
        }
        const { payload } = await jwtVerify(jwt, new TextEncoder().encode(context.env.AUTH_SECRET));
        console.log("User API Payload>>>", payload)
        // Parse query parameters
        const url = new URL(request.url);
        const detail = url.searchParams.get('detail');
        if (detail === 'true') {
            // Query Database for user details
            const userQuery = `SELECT * FROM users WHERE id =?`;
            const userResult = await context.env.D1.prepare(userQuery).bind(payload.id).first();
            if(userResult){
                const returnData = {
                    id: userResult.id,
                    username: userResult.username,
                    created_at: userResult.created_at,
                    plan_type: userResult.plan_type,
                    plan_started_at: userResult.plan_started_at,
                    plan_expired_at: userResult.plan_expired_at,
                }
                // console.log("User API Return Data>>>", returnData)
                return new Response(JSON.stringify({ user: returnData }), {
                    headers: { 'Content-Type': 'application/json' },
                    status: 200,
                });
            } else {
                return new Response(JSON.stringify({ user: null }), {
                    headers: { 'Content-Type': 'application/json' },
                    status: 404,
                });
            }
        } else{
            return new Response(JSON.stringify({ user: payload }), {
                headers: { 'Content-Type': 'application/json' },
                status: 200,
            });
        }
    } catch (error) {
        console.error("Error in verifying User>>>", error);
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