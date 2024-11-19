import { jwtVerify } from 'jose';
import * as jose from 'jose'
import { generateIdFromEntropySize } from "lucia";
import type { Env } from '../../auth';

export async function onRequestPost(context: { request: Request; env: Env }) {
    try {
        const { request } = context;
        const cookie = request.headers.get('cookie');
        const jwt = cookie?.split('; ').find((row: string) => row.startsWith('auth_token='))?.split('=')[1];

        if (!jwt) {
            // If jwf is null
            console.log("No JWT found in cookie")
            return new Response(JSON.stringify({ res: 'Unauthorized' }), {
                headers: { 'Content-Type': 'application/json' },
                status: 401,
            });
        }
        const { payload } = await jwtVerify(jwt, new TextEncoder().encode(context.env.AUTH_SECRET));

        // Get Data from POST
        const formData = await request.formData();
        console.log("Create Workspace API Data>>>", formData)
        // Extract data from formData
        const workspaceName = formData.get('workspaceName') as string;
        // generate workspace id
        const workspcaeId = generateIdFromEntropySize(10);
        // Insert Workspace data into workspaces table
        const insertQuery = await context.env.D1.prepare(
            "INSERT INTO workspaces (id, name, owner_id) VALUES (?, ?, ?)"
        ).bind(workspcaeId, workspaceName, payload.id).run();
        // Insert Owner member into members table
        const insertMemberQuery = await context.env.D1.prepare(
            "INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (?,?,?)"
        ).bind(workspcaeId, payload.id, 'OWNER').run();
        console.log("Insert Workflow Query Successful");
        
        // Return response
        return new Response(JSON.stringify({ res: 'Create Workspace Successful', workspaceId: workspcaeId }), {
            headers: { 'Content-Type': 'application/json' },
            status: 201,
        });
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