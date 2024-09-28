import { jwtVerify } from 'jose';
import * as jose from 'jose'
import { generateIdFromEntropySize } from "lucia";
import type { Env } from '../auth';

export async function onRequestPost(context: { request: Request; env: Env }) {
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
    try {
        const { payload } = await jwtVerify(jwt, new TextEncoder().encode(context.env.AUTH_SECRET));
        console.log("Upload API Payload from JWT>>>", payload)
        // // Verify payload with Cloudflare D1 Users Table
        // const { results } = await context.env.D1.prepare(
        //     "SELECT * FROM users WHERE id =?"
        // ).bind(payload.id).all();
        // if (results.length === 0 || results[0].username !== payload.username) {
        //     console.log("User not found or username does not match")
        //     return new Response(JSON.stringify({ res: 'Unauthorized' }), {
        //         headers: { 'Content-Type': 'application/json' },
        //         status: 401,
        //     });
        // }
        console.log("User Authorized")
        // Get Data from POST
        const formData = await request.formData();
        console.log("Upload API Data>>>", formData)
        // Extract data from formData
        const workflowName = formData.get('workflowname') as string;
        const description = formData.get('description') as string;
        const version = formData.get('version') as string;
        const dslFile = formData.get('dsl-file') as File;
        const tags = formData.get('tags') as string;
        const icon = formData.get('icon') as string;
        const author = JSON.stringify({ "authorName": formData.get('author-name') as string, "socialLink": formData.get('social-link') as string })
        // Read the file content as binary data
        const dslFileBuffer = await dslFile.arrayBuffer();
        const dslFileContent = new Uint8Array(dslFileBuffer);
        // generate workflow id
        const fileId = generateIdFromEntropySize(10);
        // generate workflow version id
        const versionId = generateIdFromEntropySize(10);
        // Insert data into Cloudflare D1
        console.log("Inserting data into Cloudflare D1")
        const insertQuery = await context.env.D1.prepare(
            "INSERT INTO yaml_files (id, user_id, filename, description, latest_version, tags, author_data, icon) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
        ).bind(fileId, payload.id, workflowName, description, version, tags, author, icon).run();
        console.log("Insert Workflow Query Result>>>", insertQuery);
        // Insert version data into Cloudflare D1
        const insertVersionQuery = await context.env.D1.prepare(
            "INSERT INTO yaml_versions (id, yaml_file_id, version, file_content) VALUES (?,?,?,?)"
        ).bind(versionId, fileId, version, dslFileContent).run();
        console.log("Insert Workflow Version Query Result>>>", insertVersionQuery);
        // Return response
        return new Response(JSON.stringify({ res: 'Upload successful' }), {
            headers: { 'Content-Type': 'application/json' },
            status: 201,
        });
    } catch (error) {
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