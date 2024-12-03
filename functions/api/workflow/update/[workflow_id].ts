import type { Env } from '../../auth';
import { jwtVerify } from 'jose';
import * as jose from 'jose'
import { generateIdFromEntropySize } from "lucia";
import { generateFileKey, encryptFile } from '../../../crypto';

export const onRequestPost: PagesFunction<Env> = async (context) => {
    try {
        console.log("Update Version Request....")
        const { request, params } = context;
        const cookie = request.headers.get('cookie');
        const workflowId = params.workflow_id
        if (!workflowId) {
            console.log("No Workflow ID found in params")
            return new Response(JSON.stringify({ error: 'Bad Request' }), {
                headers: { 'Content-Type': 'application/json' },
                status: 400,
            });
        }
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
        // Verify that the owner of the workflow to be update is the requesting user or is a workspace member
        const workflowResult = await context.env.D1.prepare(
            "SELECT * FROM yaml_files WHERE id =?"
        ).bind(workflowId).first() as any;
        const is_private = workflowResult.is_private
        // console.log("workflowUserId>>>", workflowResult.user_id, "payloadID>>>", payload.id)
        if (workflowResult.user_id !== payload.id) {
            // 如果用户ID不匹配，判断是否为Workspace文件
            const workspace_id = workflowResult.workspace_id;
            if(workspace_id !== undefined){
                console.log("This workflow is workspace file, check whether user is the member.>>>", workspace_id, payload.id)
                // 如果存在 workspace_id，则查询用户是否为成员
                const workspaceMemberResult = await context.env.D1.prepare(`SELECT * FROM workspace_members WHERE user_id =? AND workspace_id =?`).bind(payload.id, workspace_id).first();
                console.log("workspaceMemberResult>>>", workspaceMemberResult)
                if(!workspaceMemberResult){
                    // 如果不存在成员关系，返回403 Forbidden
                    console.log("Private Deny!!", payload.id, workspace_id)
                    return new Response(JSON.stringify({ error: "Forbidden" }), {
                        headers: { 'Content-Type': 'application/json' },
                        status: 403,
                    });
                }
            } else {
                // 如果不存在 workspace_id，则返回403 Forbidden
                console.log("Private Deny!!", payload.id, workflowResult.user_id)
                return new Response(JSON.stringify({ error: "Forbidden" }), {
                    headers: { 'Content-Type': 'application/json' },
                    status: 403,
                });
            }
        }
        // Update workflow version
        const formData = await request.formData();
        console.log("Edit Upload API Data>>>", formData)
        // Extract data from formData
        const updatedVersion = formData.get('updateVersion') as string;
        const dslFile = formData.get('dsl-file') as File;
        // Read the file content as binary data
        const dslFileBuffer = await dslFile.arrayBuffer();
        let dslFileContent = new Uint8Array(dslFileBuffer);
        // if isPrivate file
        if (is_private === 1) {
            // Get user register time
            const userQuery = await context.env.D1.prepare(
                "SELECT created_at FROM users WHERE id = ?"
            ).bind(payload.id).first();
            if (userQuery) {
                console.log("Encrypting file content")
                // Generate a key for encryption
                const encryptionKey = await generateFileKey(
                    payload.id as string,
                    userQuery.created_at as string,
                    context.env.AUTH_SECRET
                );
                // Encrypt file content
                dslFileContent = await encryptFile(dslFileContent, encryptionKey);
            }
        }
        // generate new id of new version of workflow file
        const fileId = generateIdFromEntropySize(10);
        // Insert new version data of workflow in the database
        console.log("Insert workflow's new version content in the database")
        const insertVersionQuery = await context.env.D1.prepare("INSERT INTO yaml_versions (id, yaml_file_id, version, file_content, user_id) VALUES (?,?,?,?,?)")
            .bind(fileId, workflowId, updatedVersion, dslFileContent, payload.id).run();
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