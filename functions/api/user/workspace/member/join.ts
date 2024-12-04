import { jwtVerify } from 'jose';
import * as jose from 'jose'
import type { Env } from '../../../auth';
import { createJWT } from "../../../../jwtUtils";
import { checkUserPlan } from '../../../../planUtils';
import type { CheckUserPlanResult } from '../../../../planUtils';

const FREE_PLAN_MAX_WORKSPACE = 0;
const TEAM_PLAN_MAX_WORKSPACE = 1;
const ENTERPRISE_PLAN_MAX_WORKSPACE = 10;

const FREE_PLAN_MAX_MEMBERS = 0;
const TEAM_PLAN_MAX_MEMBERS = 10;
const ENTERPRISE_PLAN_MAX_MEMBERS = 100;

interface workspacePayload {
    user_id: string;
    username: string;
    workspace_id: string;
    role: string;
}

// Add member to workspace by token
export async function onRequestPost(context: { request: Request; env: Env }) {
    console.log("Join Workspace POST Request...")
    try {
        const { request } = context;
        const cookie = request.headers.get('cookie');
        const jwt = cookie?.split('; ').find((row: string) => row.startsWith('auth_token='))?.split('=')[1];
        // Authenticate the user by JWT
        if (!jwt) {
            // If jwf is null
            console.log("No JWT found in cookie")
            return new Response(JSON.stringify({ res: 'Unauthorized, please login first.' }), {
                headers: { 'Content-Type': 'application/json' },
                status: 401,
            });
        }
        const { payload } = await jwtVerify(jwt, new TextEncoder().encode(context.env.AUTH_SECRET));
        console.log("UserPayload>>>", payload)
        // Get workspace info from JWT token in formdata
        const formData = await request.formData();
        const workspaceToken = decodeURIComponent(formData.get('workspaceToken') as string) || null;
        if(!workspaceToken){
            console.log("No Workspace Token found in formdata")
            return new Response(JSON.stringify({ res: 'Bad Request' }), {
                headers: { 'Content-Type': 'application/json' },
                status: 400,
            });
        } else {
            let workspacePayload: workspacePayload;
            try{
                workspacePayload = await jwtVerify(workspaceToken, new TextEncoder().encode(context.env.AUTH_SECRET)) as unknown as workspacePayload;
            } catch (error) {
                console.log("Invalid Workspace Token")
                return new Response(JSON.stringify({ res: "Invalid or Expired Workspace Token. Please check it or contact the workspace's owner to get a new token" }), {
                    headers: { 'Content-Type': 'application/json' },
                    status: 403,
                });
            }
            console.log("Workspace Token Decoded>>>", workspacePayload)
            // const { payload: workspacePayload } = await jwtVerify(workspaceToken, new TextEncoder().encode(context.env.AUTH_SECRET));
            const workspace_id = workspacePayload.workspace_id;
            const inviteUserId = workspacePayload.user_id;
            const inviteUserName = workspacePayload.username;
            const inviteRole = workspacePayload.role;
            // Check If the user is already in the workspace
            console.log("Check if the user is already in the workspace...UserID>>>", payload.id, "WorkspaceID>>>", workspace_id)
            const workspaceMemberResult = await context.env.D1.prepare(
                "SELECT * FROM workspace_members WHERE user_id =? AND workspace_id =?"
            ).bind(payload.id, workspace_id).first() as any;
            if(workspaceMemberResult){
                console.log("User already in the workspace")
                return new Response(JSON.stringify({ res: 'You are already in the workspace' }), {
                    headers: { 'Content-Type': 'application/json' },
                    status: 403,
                });
            }
            // Check if the workspace owner's plan is expired
            const planCheckResult = await checkUserPlan(inviteUserId as string, context.env) as CheckUserPlanResult;
            console.log("User not in workspace, check owner's plan>>>", planCheckResult)
            if (planCheckResult.expired || planCheckResult.plan_type === 'FREE') {
                console.log("Owner's plan is invaild")
                return new Response(JSON.stringify({ res: planCheckResult.message }), {
                    headers: { 'Content-Type': 'application/json' },
                    status: 403,
                });
            } else {
                console.log("Owner's plan is valid, check plan's quata...")
                // Query owner's workspace count and member count
                const workspaceCount = await context.env.D1.prepare(
                    "SELECT COUNT(*) AS count FROM workspaces WHERE owner_id =?"
                ).bind(inviteUserId).first() as any;
                const memberCount = await context.env.D1.prepare(
                    "SELECT COUNT(*) AS count FROM workspace_members WHERE workspace_id =?"
                ).bind(workspace_id).first() as any;
                const workspaceCountResult = workspaceCount.count;
                const memberCountResult = memberCount.count;
                console.log("WorkspaceCount>>>", workspaceCountResult, "MemberCount>>>", memberCountResult)
                // Check user workspace count and member count whether it exceeds the plan limit
                if (planCheckResult.plan_type === 'TEAM') {
                    if (workspaceCountResult > TEAM_PLAN_MAX_WORKSPACE) {
                        // If the user has reached the maximum number of workspaces for the Team plan
                        console.log("Workspace count exceeded")
                        return new Response(JSON.stringify({ res: 'The quota for the workspace you wish to join has been exceeded, please contact the workspace owner.' }), {
                            headers: { 'Content-Type': 'application/json' },
                            status: 403,
                        });
                    } else if (memberCountResult >= TEAM_PLAN_MAX_MEMBERS) {
                        // If the user has reached the maximum number of members for the Team plan
                        console.log("Member count exceeded")
                        return new Response(JSON.stringify({ res: 'The workspace member quota you wish to join has been exceeded, please contact the workspace owner.' }), {
                            headers: { 'Content-Type': 'application/json' },
                            status: 403,
                        });
                    }
                } else if (planCheckResult.plan_type === 'ENTERPRISE') {
                    if (workspaceCountResult > ENTERPRISE_PLAN_MAX_WORKSPACE) {
                        // If the user has reached the maximum number of workspaces for the Enterprise plan
                        console.log("Workspace count exceeded")
                        return new Response(JSON.stringify({ res: 'The quota for the workspace you wish to join has been exceeded, please contact the workspace owner.' }), {
                            headers: { 'Content-Type': 'application/json' },
                            status: 403,
                        });
                    } else if (memberCountResult >= ENTERPRISE_PLAN_MAX_MEMBERS) {
                        // If the user has reached the maximum number of members for the Enterprise plan
                        console.log("Member count exceeded")
                        return new Response(JSON.stringify({ res: 'The workspace member quota you wish to join has been exceeded, please contact the workspace owner.' }), {
                            headers: { 'Content-Type': 'application/json' },
                            status: 403,
                        });
                    }
                }
                // If workspace quota is under limit, join the workspace
                console.log("All conditions are met, ready to join the workspace...")
                const workspaceMemberInsertResult = await context.env.D1.prepare(
                    "INSERT INTO workspace_members (user_id, workspace_id, role) VALUES (?,?,?)"
                ).bind(payload.id, workspace_id, inviteRole).run();
                return new Response(JSON.stringify({ res: "Join " + inviteUserName + "'s Workspace successfully." }), {
                    headers: { 'Content-Type': 'application/json' },
                    status: 200,
                });
            }
        }
    } catch (error) {
        console.error('Error in Join Workspace>>>', error);
        if (error instanceof jose.errors.JOSEError) {
            console.error("JWT Expired", error);
            return new Response(JSON.stringify({ res: 'User Verification Failed, please login again.' }), {
                headers: { 'Content-Type': 'application/json' },
                status: 401,
            });
        } else {
            return new Response(JSON.stringify({ res: 'Internal Server Error, please try again later or contact Diflowy official.' }), {
                headers: { 'Content-Type': 'application/json' },
                status: 500,
            });
        }
    }
}