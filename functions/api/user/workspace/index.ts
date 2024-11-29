// Get all joined and managed workspaces of the user
import { jwtVerify } from 'jose';
import * as jose from 'jose'
import type { Env } from '../../auth';
import { checkUserPlan } from '../../../planUtils';
import type { CheckUserPlanResult } from '../../../planUtils';

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
        // const userQuery = `SELECT * FROM users WHERE id =?`;
        const workspaceMembersQuery = `SELECT w.*, wm.role FROM workspaces w JOIN workspace_members wm ON w.id = wm.workspace_id WHERE wm.user_id = ?`;
        const managedWorkspacesQuery = `SELECT w.*, COUNT(wm.user_id) AS member_count, SUM(COUNT(wm.user_id)) OVER () AS total_member_count FROM workspaces w LEFT JOIN workspace_members wm ON w.id = wm.workspace_id WHERE w.owner_id = ? GROUP BY w.id`;
        // const userResult = await context.env.D1.prepare(userQuery).bind(payload.id).first();
        let workspaceData;
        // Check if the workspace owner's plan is expired
        const planCheckResult = await checkUserPlan(payload.id as string, context.env) as CheckUserPlanResult;
        const workspaceMembersResult = await context.env.D1.prepare(workspaceMembersQuery).bind(payload.id).all();
        if (planCheckResult.expired || planCheckResult.plan_type === 'FREE') {
            // If user's plan is free or is expired, only return joined workspace
            workspaceData = {
                joined: {
                    workspaces: (workspaceMembersResult.results as any[]).map(row => ({
                        id: row.id,
                        name: row.name,
                        owner_id: row.owner_id,
                        role: row.role,
                        created_at: row.created_at,
                    })),
                    total: workspaceMembersResult.results.length || 0,
                },
                managed: null,
            };
        } else {
            // If user's plan isn't free and isn't expired, return joined and managed workspace
            const managedWorkspacesResult = await context.env.D1.prepare(managedWorkspacesQuery).bind(payload.id).all();
            workspaceData = {
                joined: {
                    workspaces: (workspaceMembersResult.results as any[]).map(row => ({
                        id: row.id,
                        name: row.name,
                        owner_id: row.owner_id,
                        role: row.role,
                        created_at: row.created_at,
                    })),
                    total: workspaceMembersResult.results.length || 0,
                },
                managed: {
                    workspaces: (managedWorkspacesResult.results as any[]).map(row => ({
                        id: row.id,
                        name: row.name,
                        owner_id: row.owner_id,
                        created_at: row.created_at,
                        member_count: row.member_count, // Include the member count
                    })),
                    total: managedWorkspacesResult.results.length || 0,
                    total_member_count: managedWorkspacesResult.results?.reduce((sum, row) => sum + (row.member_count as number), 0) || 0,
                },
            };
        }       
        console.log("User API Response>>>", planCheckResult, "Workspace API Response>>>", workspaceData)
        return new Response(JSON.stringify({ user: planCheckResult, workspacesObject: workspaceData }), {
            headers: { 'Content-Type': 'application/json' },
            status: 200,
        });
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