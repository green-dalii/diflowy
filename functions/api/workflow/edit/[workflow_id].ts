import type { Env } from '../../auth';
import { jwtVerify } from 'jose';
import * as jose from 'jose'

export const onRequestPost: PagesFunction<Env> = async (context) => {
    try{
        console.log("Edit Meta Data Request....")
        const { request, params } = context;
        const cookie = request.headers.get('cookie');
        const workflowId = params.workflow_id
        if(!workflowId){
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
        // Verify that the owner of the workflow to be edit is the requesting user
        const workflowResult  = await context.env.D1.prepare(
            "SELECT * FROM yaml_files WHERE id =?"
        ).bind(workflowId).first() as any;
        console.log("workflowResult>>>", workflowResult.user_id, "payloadID>>>", payload.id)
        if(workflowResult.user_id !== payload.id){
            console.log("User ID is not match the workflow user_id, trying to check workspace membership...UserID>>>", payload.id, "workflow UserID>>>", workflowResult.user_id)
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
        // Edit the workflow's meta data
        const formData = await request.formData();
        console.log("Edit Upload API Data>>>", formData)
        // Extract data from formData
        const workflowName = formData.get('editWorkflowName') as string;
        const tags = formData.get('tags') as string;
        const description = formData.get('editWorkflowDescription') as string;
        const author = JSON.stringify({ "authorName": formData.get("editWorkflowAuthor") as string, "socialLink": formData.get("editWorkflowAuthorLink") as string });
        // const isPrivate = formData.get('isPrivate') || false;
        // const is_private = isPrivate === "on" ? 1 : 0 || 0;
        // Update the workflow's meta data
        console.log("Updating workflow's meta data")
        const updateQuery = await context.env.D1.prepare(
            "UPDATE yaml_files SET filename = ?, description = ?, tags = ?, author_data = ? WHERE id = ?"
        ).bind(workflowName, description, tags, author, workflowId).run();
        console.log("Update Workflow Query Result>>>", updateQuery);
        // Return the reponse
        return new Response(JSON.stringify({ res: 'Edit Meta Data Success' }), {
            headers: { 'Content-Type': 'application/json' },
            status: 200,
        });
    } catch (error) {
        console.error("Error in Edit Workflow Request>>>>", error)
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