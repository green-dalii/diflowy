import { jwtVerify } from 'jose';
import * as jose from 'jose'
import type { Env } from '../../auth';

interface Workspace {
    id: string;
    name: string;
    owner_id: string;
    created_at: string;
}

interface WorkspaceMembers {
    user_id: string;
    workspace_id: string;
    role: string;
    joined_at: string;
}

export async function onRequest(context: { request: Request; env: Env }) {
    try {
        const { request } = context;
        // get cookie
        const cookie = request.headers.get('cookie');
        const jwt = cookie?.split('; ').find((row: string) => row.startsWith('auth_token='))?.split('=')[1];
        // console.log("User API JWT>>>", jwt)
        if (!jwt) {
            return new Response(JSON.stringify({ user: null, workspace: null }), {
                headers: { 'Content-Type': 'application/json' },
                status: 401,
            });
        }
        const { payload } = await jwtVerify(jwt, new TextEncoder().encode(context.env.AUTH_SECRET));

        // Query Database for user workspace details
        const userQuery = `SELECT * FROM users WHERE id =?`;
        const workspaceMembersQuery = `
                                        SELECT w.* 
                                        FROM workspaces w
                                        JOIN workspace_members wm ON w.id = wm.workspace_id
                                        WHERE wm.user_id = ?
                                    `;
        const userResult = await context.env.D1.prepare(userQuery).bind(payload.id).first();
        if(userResult){
            const userData = {
                id: userResult.id,
                username: userResult.username,
                created_at: userResult.created_at,
                plan_type: userResult.plan_type,
                plan_started_at: userResult.plan_started_at,
                plan_expired_at: userResult.plan_expired_at,
            }
            let workspaceData;
            // If user plan is FREE, return none of workspace 
            if(userData.plan_type === 'FREE'){
                workspaceData = null;
            } else {
                // If user plan is not FREE, query workspaces info
                const workspaceMembersResult = await context.env.D1.prepare(workspaceMembersQuery).bind(payload.id).all();

                // Get all workspaces info of user joined in
                const workspaces: Workspace[] = (workspaceMembersResult.results as any[]).map(row => ({
                    id: row.id,
                    name: row.name,
                    owner_id: row.owner_id,
                    created_at: row.created_at,
                }));
                workspaceData = workspaces;                
            }
            
            return new Response(JSON.stringify({ user: userData, workspace: workspaceData }), {
                headers: { 'Content-Type': 'application/json' },
                status: 200,
            });
        } else {
            return new Response(JSON.stringify({ user: null, workspace: null }), {
                headers: { 'Content-Type': 'application/json' },
                status: 404,
            });
        }
    } catch (error) {
        console.error("Error in verifying User>>>", error);
        if (error instanceof jose.errors.JOSEError) {
            console.error("JWT Expired", error);
            return new Response(JSON.stringify({ user: null, workspace: null }), {
                headers: { 'Content-Type': 'application/json' },
                status: 401,
            });
        } else {
            return new Response(JSON.stringify({ user: null, workspace: null }), {
                headers: { 'Content-Type': 'application/json' },
                status: 500,
            });
        }
    }
}