import { jwtVerify } from 'jose';
import * as jose from 'jose'
import type { Env } from '../../auth';

interface Members {
    id: string;
    username: string;
    role: string;
    joined_at: string;
}

interface WorkspaceResponse {
    id: string;
    name: string;
    owner_id: string;
    created_at: string;
    members: Members[];
}

export async function onRequestGet(context: { request: Request; env: Env; params: { workspace_id: string } }) {
    try {
        const { request, params } = context;
        // get cookie
        const cookie = request.headers.get('cookie');
        const jwt = cookie?.split('; ').find((row: string) => row.startsWith('auth_token='))?.split('=')[1];
        if (!jwt) {
            return new Response(JSON.stringify({ workspace: null }), {
                headers: { 'Content-Type': 'application/json' },
                status: 401,
            });
        }
        const { payload } = await jwtVerify(jwt, new TextEncoder().encode(context.env.AUTH_SECRET));
        // Get workspace_id from params
        const workspace_id = params.workspace_id;
        if(!workspace_id){
            return new Response(JSON.stringify({ workspace: null }), {
                headers: { 'Content-Type': 'application/json' },
                status: 400,
            });
        }
        // if user is not the member of this workspace, return 403
        const isMemberQuery = `SELECT * FROM workspace_members WHERE workspace_id = ? AND user_id = ?`
        const isMemberResult = await context.env.D1.prepare(isMemberQuery).bind(workspace_id, payload.id).first();
        if(!isMemberResult){
            return new Response(JSON.stringify({ workspace: null }), {
                headers: { 'Content-Type': 'application/json' },
                status: 403,
            });
        } else{
            // User is the member of this workspace, Query for more info
            const workspaceQuery = `SELECT * FROM workspaces WHERE id =?`;
            const workspaceMembersQuery = `SELECT w.id AS workspace_id, w.name AS workspace_name, w.owner_id AS owner_id, w.created_at AS created_at, u.id AS user_id, u.username AS username, wm.role, wm.joined_at FROM workspaces w JOIN workspace_members wm ON w.id = wm.workspace_id JOIN users u ON wm.user_id = u.id WHERE w.id = ?`;
            const workspaceResult = await context.env.D1.prepare(workspaceQuery).bind(workspace_id).first();
            if(workspaceResult){
                // if user is the member of this workspace， return workspace info
                const workspaceMembersResult = await context.env.D1.prepare(workspaceMembersQuery).bind(workspace_id).all();
                if (workspaceMembersResult.results.length === 0) {
                    return new Response(JSON.stringify({ error: 'Workspace not found' }), {
                        headers: { 'Content-Type': 'application/json' },
                        status: 404,
                    });
                }
        
                const workspaceDetails = workspaceMembersResult.results[0];
                const members: Members[] = workspaceMembersResult.results.map(row => ({
                    id: row.user_id as string,
                    username: row.username as string,
                    role: row.role as string,
                    joined_at: row.joined_at as string,
                }));
        
                const workspaceResponse: WorkspaceResponse = {
                    id: workspaceDetails.workspace_id as string,
                    name: workspaceDetails.workspace_name as string,
                    owner_id: workspaceDetails.owner_id as string,
                    created_at: workspaceDetails.created_at as string,
                    members: members,
                };
                console.log("Workspace API Return Data>>>", workspaceResponse)
                return new Response(JSON.stringify(workspaceResponse), {
                    headers: { 'Content-Type': 'application/json' },
                    status: 200,
                });
            } else {
                return new Response(JSON.stringify({ error: 'Workspace not found' }), {
                    headers: { 'Content-Type': 'application/json' },
                    status: 404,
                });
            }
        }
    } catch (error) {
        console.error("Error in verifying User and Querying Workspace>>>", error);
        if (error instanceof jose.errors.JOSEError) {
            console.error("JWT Expired", error);
            return new Response(JSON.stringify({ error: "JWT Expired" }), {
                headers: { 'Content-Type': 'application/json' },
                status: 401,
            });
        } else {
            return new Response(JSON.stringify({ error: "Forbidden" }), {
                headers: { 'Content-Type': 'application/json' },
                status: 500,
            });
        }
    }
}