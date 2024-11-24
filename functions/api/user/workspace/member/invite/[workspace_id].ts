import { jwtVerify } from 'jose';
import * as jose from 'jose'
import type { Env } from '../../../../auth';
import { createJWT } from "../../../../../jwtUtils";
import { checkUserPlan } from '../../../../../planUtils';

const FREE_PLAN_MAX_WORKSPACE = 0;
const TEAM_PLAN_MAX_WORKSPACE = 1;
const ENTERPRISE_PLAN_MAX_WORKSPACE = 10;

const FREE_PLAN_MAX_MEMBERS = 0;
const TEAM_PLAN_MAX_MEMBERS = 10;
const ENTERPRISE_PLAN_MAX_MEMBERS = 100;

export async function onRequestPost(context: { request: Request; env: Env; params: { workspace_id: string } }) {
    try {
        const { request, params } = context;
        const workspace_id = params.workspace_id;
        const cookie = request.headers.get('cookie');
        const jwt = cookie?.split('; ').find((row: string) => row.startsWith('auth_token='))?.split('=')[1];
        // Check if Workspace ID is null
        if(!workspace_id){
            console.log("No Workspace ID found in params")
            return new Response(JSON.stringify({ error: 'Bad Request' }), {
                headers: { 'Content-Type': 'application/json' },
                status: 400,
            });
        }
        // Authenticate the user by JWT
        if (!jwt) {
            // If jwf is null
            console.log("No JWT found in cookie")
            return new Response(JSON.stringify({ res: 'Unauthorized' }), {
                headers: { 'Content-Type': 'application/json' },
                status: 401,
            });
        }
        const { payload } = await jwtVerify(jwt, new TextEncoder().encode(context.env.AUTH_SECRET));
        // Verify that the user requesting invite member is the owner or admin of the workspace
        const workspaceResult  = await context.env.D1.prepare(
            "SELECT * FROM workspace_members WHERE user_id =? AND workspace_id =?"
        ).bind(payload.id, workspace_id).first() as any;
        console.log("workspace owner_id>>>", workspaceResult.owner_id, "payloadID>>>", payload.id)
        if(!workspaceResult){
            console.log("User not authorized to operate this workspace")
            return new Response(JSON.stringify({ res: 'Unauthorized' }), {
                headers: { 'Content-Type': 'application/json' },
                status: 401,
            });
        } else if((workspaceResult.role !== "OWNER") || (workspaceResult.role !== "ADMIN") ){
            // If the user is not the owner or admin of the workspace
            console.log("User not authorized to delete this member")
            return new Response(JSON.stringify({ res: 'Unauthorized' }), {
                headers: { 'Content-Type': 'application/json' },
                status: 403,
            });
        } else {
            // Check user plan
            const planCheckResult = await checkUserPlan(payload.id as string, context.env);
            if (planCheckResult.expired || planCheckResult.plan_type === 'FREE') {
                return new Response(JSON.stringify({ res: planCheckResult.message }), {
                    headers: { 'Content-Type': 'application/json' },
                    status: 403,
                });
            } else {
                // Check user workspace count
                const workspaceCount = await context.env.D1.prepare(
                    "SELECT COUNT(*) AS count FROM workspaces WHERE owner_id =?"
                ).bind(payload.id).first() as any;
                const memberCount = await context.env.D1.prepare(
                    "SELECT COUNT(*) AS count FROM workspace_members WHERE workspace_id =?"
                ).bind(workspace_id).first() as any;
                const workspaceCountResult = workspaceCount.count;
                const memberCountResult = memberCount.count;
                // Check user workspace count and member count whether it exceeds the plan limit
                if (planCheckResult.plan_type === 'TEAM') {
                    if (workspaceCountResult >= TEAM_PLAN_MAX_WORKSPACE) {
                        // If the user has reached the maximum number of workspaces for the Team plan
                        return new Response(JSON.stringify({ res: 'You have reached the maximum number of workspaces for the Team plan' }), {
                            headers: { 'Content-Type': 'application/json' },
                            status: 403,
                        });
                    } else if (memberCountResult >= TEAM_PLAN_MAX_MEMBERS) {
                        // If the user has reached the maximum number of members for the Team plan
                        return new Response(JSON.stringify({ res: 'You have reached the maximum number of members for the Team plan' }), {
                            headers: { 'Content-Type': 'application/json' },
                            status: 403,
                        });
                    }
                } else if (planCheckResult.plan_type === 'ENTERPRISE') {
                    if (workspaceCountResult >= ENTERPRISE_PLAN_MAX_WORKSPACE) {
                        // If the user has reached the maximum number of workspaces for the Enterprise plan
                        return new Response(JSON.stringify({ res: 'You have reached the maximum number of workspaces for the Enterprise plan' }), {
                            headers: { 'Content-Type': 'application/json' },
                            status: 403,
                        });
                    } else if (memberCountResult >= ENTERPRISE_PLAN_MAX_MEMBERS) {
                        // If the user has reached the maximum number of members for the Enterprise plan
                        return new Response(JSON.stringify({ res: 'You have reached the maximum number of members for the Enterprise plan' }), {
                            headers: { 'Content-Type': 'application/json' },
                            status: 403,
                        });
                    }
                }
                // If the user has not reached the maximum number of workspaces or members for the plan, continue generating invite JWT
                const workspaceInvitePayload = {
                    user_id: payload.id,
                    user_name: payload.username,
                    workspace_id: workspace_id,
                    role: 'MEMBER',
                };
                // Generate invite JWT
                const inviteJWT = await createJWT(workspaceInvitePayload, context.env.AUTH_SECRET, '24h');
                // URL encode invite JWT
                const inviteJWTEncoded = encodeURIComponent(inviteJWT);
                return new Response(JSON.stringify({ token: inviteJWTEncoded }), {
                    headers: { 'Content-Type': 'application/json' },
                    status: 200,
                });
            }
        }
    } catch (error) {
        console.error('Error in Create Workspace>>>', error);
        if (error instanceof jose.errors.JOSEError) {
            console.error("JWT Expired", error);
            return new Response(JSON.stringify({ res: 'JWT Broken' }), {
                headers: { 'Content-Type': 'application/json' },
                status: 401,
            });
        } else {
            return new Response(JSON.stringify({ res: 'Internal Server Error' }), {
                headers: { 'Content-Type': 'application/json' },
                status: 500,
            });
        }
    }
}