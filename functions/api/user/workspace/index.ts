// Get all joined and managed workspaces of the user
import { jwtVerify } from 'jose';
import * as jose from 'jose'
import type { Env } from '../../auth';

interface Workspace {
    id: string;
    name: string;
    owner_id: string;
    role: string;
    created_at: string;
}

interface WorkspaceResponse {
    workspaces: Workspace[];
    total: number;
}

export async function onRequest(context: { request: Request; env: Env }) {
    try {
        const { request } = context;
        // get cookie
        const cookie = request.headers.get('cookie');
        const jwt = cookie?.split('; ').find((row: string) => row.startsWith('auth_token='))?.split('=')[1];
        if (!jwt) {
            return new Response(JSON.stringify({ user: null, workspace: null }), {
                headers: { 'Content-Type': 'application/json' },
                status: 401,
            });
        }
        const { payload } = await jwtVerify(jwt, new TextEncoder().encode(context.env.AUTH_SECRET));

        // Query Database for user workspace details
        const userQuery = `SELECT * FROM users WHERE id =?`;
        const workspaceMembersQuery = `SELECT w.*, wm.role FROM workspaces w JOIN workspace_members wm ON w.id = wm.workspace_id WHERE wm.user_id = ?`;
        const managedWorkspacesQuery = `SELECT w.*, COUNT(wm.user_id) AS member_count, SUM(COUNT(wm.user_id)) OVER () AS total_member_count FROM workspaces w LEFT JOIN workspace_members wm ON w.id = wm.workspace_id WHERE w.owner_id = ? GROUP BY w.id`;
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
                // Check if plan is expired, downgrade plan to FREE
                if(userData.plan_expired_at && (new Date(userData.plan_expired_at as string) < new Date())){
                    // If plan is expired, update plan type to FREE
                    console.log("User plan expired, downgrading plan to FREE>>>", payload.id)
                    await context.env.D1.prepare(
                        "UPDATE users SET plan_type =? WHERE id =?"
                    ).bind('FREE', payload.id).run();
                }
                // If user plan is not FREE, query workspaces info
                const workspaceMembersResult = await context.env.D1.prepare(workspaceMembersQuery).bind(payload.id).all();
                // Query managed workspaces with member count
                const managedWorkspacesResult = await context.env.D1.prepare(managedWorkspacesQuery).bind(payload.id).all();
                // Get all workspaces info of user joined in
                const workspaces: WorkspaceResponse = {
                    workspaces: (workspaceMembersResult.results as any[]).map(row => ({
                        id: row.id,
                        name: row.name,
                        owner_id: row.owner_id,
                        role: row.role,
                        created_at: row.created_at,
                    })),
                    total: workspaceMembersResult.results.length,
                };

                // Get all managed workspaces info with member count
                const managedWorkspaces = {
                    workspaces: (managedWorkspacesResult.results as any[]).map(row => ({
                        id: row.id,
                        name: row.name,
                        owner_id: row.owner_id,
                        created_at: row.created_at,
                        member_count: row.member_count, // Include the member count
                    })),
                    total: managedWorkspacesResult.results[0]?.total_member_count || 0
                };
                // Return both joined and managed workspaces
                workspaceData = {
                    joined: workspaces,
                    managed: managedWorkspaces,
                };            
            }
            console.log("User API Response>>>", userData, "Workspace API Response>>>", workspaceData)
            return new Response(JSON.stringify({ user: userData, workspacesObject: workspaceData }), {
                headers: { 'Content-Type': 'application/json' },
                status: 200,
            });
        } else {
            return new Response(JSON.stringify({ user: null, workspacesObject: { joined: null, managed: null } }), {
                headers: { 'Content-Type': 'application/json' },
                status: 404,
            });
        }
    } catch (error) {
        console.error("Error in verifying User>>>", error);
        if (error instanceof jose.errors.JOSEError) {
            console.error("JWT Expired", error);
            return new Response(JSON.stringify({ user: null, workspacesObject: { joined: null, managed: null } }), {
                headers: { 'Content-Type': 'application/json' },
                status: 401,
            });
        } else {
            return new Response(JSON.stringify({ user: null, workspacesObject: { joined: null, managed: null } }), {
                headers: { 'Content-Type': 'application/json' },
                status: 500,
            });
        }
    }
}