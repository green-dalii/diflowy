// // api of user info from context.data
// // import type { EventContext } from "@cloudflare/workers-types";
// import type { Env } from "./auth";

// interface User {
//     id: string;
//     username: string;
//     // 添加其他用户属性
// }

// interface Session {
//     id: string;
//     // 添加其他会话属性
// }

// export interface AppData {
//     user: User | null;
//     session: Session | null;
// }

// export const onRequestGet: (context: EventContext<Env, any, AppData>) => Promise<Response>  = async (context): Promise<Response> => {
//     const user = context.data.user;
//     const session = context.data.session;
//     console.log("User>>>", user, "Session>>>", session)

//     if (user && session) {
//         return new Response(JSON.stringify({
//             user: {
//                 id: user.id,
//                 username: user.username
//                 // Add any other user properties you want to expose
//             },
//             authenticated: true
//         }), {
//             headers: { 'Content-Type': 'application/json' }
//         });
//     } else {
//         return new Response(JSON.stringify({
//             authenticated: false
//         }), {
//             status: 200, 
//             headers: { 'Content-Type': 'application/json' }
//         });
//     }
// }

import { jwtVerify } from 'jose';
import type { Env } from './auth';

export async function onRequest(context: { request: Request; env: Env }) {
    const { request } = context;
    const cookie = request.headers.get('cookie');
    const jwt = cookie?.split('; ').find(row => row.startsWith('jwt='))?.split('=')[1];
    console.log("User API JWT>>>", jwt)
    if (!jwt) {
        return new Response(JSON.stringify({ user: null }), {
            headers: { 'Content-Type': 'application/json' },
            status: 200,
        });
    }

    try {
        const { payload } = await jwtVerify(jwt, new TextEncoder().encode(context.env.AUTH_SECRET));
        console.log("User API Payload>>>", payload)
        return new Response(JSON.stringify({ user: payload }), {
            headers: { 'Content-Type': 'application/json' },
            status: 200,
        });
    } catch (error) {
        return new Response(JSON.stringify({ user: null }), {
            headers: { 'Content-Type': 'application/json' },
            status: 200,
        });
    }
}