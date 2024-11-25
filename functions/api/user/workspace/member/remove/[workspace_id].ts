import type { Env } from '../../../../auth';
import { jwtVerify } from 'jose';
import * as jose from 'jose'

export const onRequestDelete: PagesFunction<Env> = async (context) => {
    try{
        console.log("Removing member API Request....")
        const { request, params } = context;
        const url = new URL(request.url);
        // get member_id from url parameter
        const member_id = url.searchParams.get('member_id');
        const cookie = request.headers.get('cookie');
        const workspace_id = params.workspace_id;
        if(!workspace_id || !member_id){
            console.log("No workspace_id found in params")
            return new Response(JSON.stringify({ error: 'Bad Request' }), {
                headers: { 'Content-Type': 'application/json' },
                status: 400,
            });
        }
        const jwt = cookie?.split('; ').find((row: string) => row.startsWith('auth_token='))?.split('=')[1];
        console.log("will Delete workspace_id>>", workspace_id, "method", request.method)
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
        // Verify that the user requesting remove member is the owner of the workspace
        const workspaceResult  = await context.env.D1.prepare(
            "SELECT * FROM workspace_members WHERE user_id =? AND workspace_id =?"
        ).bind(payload.id, workspace_id).first() as any;
        console.log("workspace owner_id>>>", workspaceResult.user_id, "payloadID>>>", payload.id)
        if(!workspaceResult){
            console.log("User not authorized to operate this workspace")
            return new Response(JSON.stringify({ res: 'Unauthorized' }), {
                headers: { 'Content-Type': 'application/json' },
                status: 401,
            });
        } else if((workspaceResult.role !== "OWNER") && (workspaceResult.role !== "ADMIN") ){
            // If the user is not the owner or admin of the workspace
            console.log("User not authorized to delete this member", workspaceResult.role)
            return new Response(JSON.stringify({ res: 'Unauthorized' }), {
                headers: { 'Content-Type': 'application/json' },
                status: 403,
            });
        } else {
            // Delete the workspace from the database
            console.log("remove member from the database")
            const deleteMembersQuery = await context.env.D1.prepare(
                "DELETE FROM workspace_members WHERE user_id =?"
            ).bind(member_id).run();

            return new Response(JSON.stringify({ res: 'Member removed from the workspace Successfully' }), {
                headers: { 'Content-Type': 'application/json' },
                status: 200,
            });
        }
    } catch (error) {
        console.error("Error in remove member Request>>>>", error)
        if (error instanceof jose.errors.JOSEError) {
            console.error("JWT Expired", error);
            return new Response(JSON.stringify({ error: "JWT Expired" }), {
                headers: { 'Content-Type': 'application/json' },
                status: 401,
            });
        } else {
            return new Response(JSON.stringify({ error: 'Internal Server Error' }), {
                status: 500,
                headers: { 'Content-Type': 'application/json' }
            });
        }
    }
}