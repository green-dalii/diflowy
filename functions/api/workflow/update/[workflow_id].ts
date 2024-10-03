import type { Env } from '../../auth';
import { jwtVerify } from 'jose';
import * as jose from 'jose'
import { generateIdFromEntropySize } from "lucia";

export const onRequestPost: PagesFunction<Env> = async (context) => {
    try{
        console.log("Update Version Request....")
        const { request, params } = context;
        const cookie = request.headers.get('cookie');
        const workflowId = params.workflow_id
        const jwt = cookie?.split('; ').find((row: string) => row.startsWith('auth_token='))?.split('=')[1];
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
        // Verify that the owner of the workflow to be update is the requesting user
        const workflowUserId  = await context.env.D1.prepare(
            "SELECT user_id FROM yaml_files WHERE id =?"
        ).bind(workflowId).first() as any;
        console.log("workflowUserId>>>", workflowUserId.user_id, "payloadID>>>", payload.id)
        if(workflowUserId.user_id !== payload.id){
            // If the user is not the owner of the workflow
            console.log("User not authorized to delete this workflow")
            return new Response(JSON.stringify({ res: 'Unauthorized' }), {
                headers: { 'Content-Type': 'application/json' },
                status: 401,
            });
        } else {
            // Update workflow version
            const formData = await request.formData();
            console.log("Edit Upload API Data>>>", formData)
            // Extract data from formData
            const updatedVersion = formData.get('updateVersion') as string;
            const dslFile = formData.get('dsl-file') as File;
            // Read the file content as binary data
            const dslFileBuffer = await dslFile.arrayBuffer();
            const dslFileContent = new Uint8Array(dslFileBuffer);
            // generate new id of new version of workflow file
            const fileId = generateIdFromEntropySize(10);
            // Insert new version data of workflow in the database
            console.log("Insert workflow's new version content in the database")
            const insertVersionQuery = await context.env.D1.prepare("INSERT INTO yaml_versions (id, yaml_file_id, version, file_content) VALUES (?,?,?,?)")
            .bind(fileId, workflowId, updatedVersion, dslFileContent).run();
            console.log("Update Workflow Query Result>>>", insertVersionQuery);
            // Update version in workflow meta data in the database
            console.log("Update workflow's version in the database")
            const updateVersionQuery = await context.env.D1.prepare(
                "UPDATE yaml_files SET latest_version =? WHERE id =?"
            ).bind(updatedVersion, workflowId).run();
            console.log("Update Workflow Query Result>>>", updateVersionQuery);
            // Return the reponse
            return new Response(JSON.stringify({ res: 'Update Version Success' }), {
                headers: { 'Content-Type': 'application/json' },
                status: 200,
            });
        }
    } catch (error) {
        console.error("Error in Update Workflow Request>>>>", error)
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