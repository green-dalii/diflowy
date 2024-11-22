import type { Env } from '../../../auth';
import { jwtVerify } from 'jose';
import * as jose from 'jose'

export const onRequestDelete: PagesFunction<Env> = async (context) => {
    try{
        console.log("Delete Workspace API Request....")
        const { request, params } = context;
        const cookie = request.headers.get('cookie');
        const workspace_id = params.workspace_id;
        if(!workspace_id){
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
        // Verify that the owner of the workspace to be deleted is the owner of the workspace
        const workspaceOwner  = await context.env.D1.prepare(
            "SELECT owner_id FROM workspaces WHERE id =?"
        ).bind(workspace_id).first() as any;
        console.log("workspace owner_id>>>", workspaceOwner.owner_id, "payloadID>>>", payload.id)
        if(workspaceOwner.owner_id !== payload.id){
            // If the user is not the owner of the workspace
            console.log("User not authorized to delete this workspace")
            return new Response(JSON.stringify({ res: 'Unauthorized' }), {
                headers: { 'Content-Type': 'application/json' },
                status: 403,
            });
        } else {
            // Delete the workspace from the database
            console.log("Deleting workspace and all members from the database")
            const deleteMembersQuery = await context.env.D1.prepare(
                "DELETE FROM workspace_members WHERE workspace_id =?"
            ).bind(workspace_id).run();
            console.log("Deleting workspace from the database")
            const deleteQuery = await context.env.D1.prepare(
                "DELETE FROM workspaces WHERE id =?"
            ).bind(workspace_id).run();

            return new Response(JSON.stringify({ res: 'Workspace and all members Deleted Successfully' }), {
                headers: { 'Content-Type': 'application/json' },
                status: 200,
            });
        }
    } catch (error) {
        console.error("Error in Delete Workspace Request>>>>", error)
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