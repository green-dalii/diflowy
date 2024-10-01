import type { Env } from '../../auth';
import { jwtVerify } from 'jose';
import * as jose from 'jose'

export const onRequestDelete: PagesFunction<Env> = async (context) => {
    try{
        console.log("Delete Request....")
        const { request, params } = context;
        const cookie = request.headers.get('cookie');
        const workflowId = params.workflow_id
        const jwt = cookie?.split('; ').find((row: string) => row.startsWith('auth_token='))?.split('=')[1];
        console.log("will Delete workflow_id>>", workflowId, "method", request.method)
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
        // Verify that the owner of the workflow to be deleted is the requesting user
        const workflowUserId  = await context.env.D1.prepare(
            "SELECT user_id FROM yaml_files WHERE id =?"
        ).bind(workflowId).first() as {user_id: string};
        console.log("workflowUserId>>>", workflowUserId.user_id, "payloadID>>>", payload.id)
        if(workflowUserId.user_id !== payload.id){
            // If the user is not the owner of the workflow
            console.log("User not authorized to delete this workflow")
            return new Response(JSON.stringify({ res: 'Unauthorized' }), {
                headers: { 'Content-Type': 'application/json' },
                status: 401,
            });
        } else {
            // Delete the workflow from the database
            console.log("Deleting workflow all version file from the database")
            const deleteVersionQuery = await context.env.D1.prepare(
                "DELETE FROM yaml_versions WHERE yaml_file_id =?"
            ).bind(workflowId).run();
            console.log("Deleting workflow meta data from the database")
            const deleteQuery = await context.env.D1.prepare(
                "DELETE FROM yaml_files WHERE id =?"
            ).bind(workflowId).run();
            console.log("Delete Workflow Query Result>>>", deleteQuery, "Delete Version Query Result>>>", deleteVersionQuery);

            return new Response(JSON.stringify({ res: 'Workflow Deleted Successfully' }), {
                headers: { 'Content-Type': 'application/json' },
                status: 200,
            });
        }
    } catch (error) {
        console.log("Error>>>>", error)
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