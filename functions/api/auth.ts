import { Lucia } from "lucia";
import { D1Adapter } from "@lucia-auth/adapter-sqlite";
import { D1Database } from "@cloudflare/workers-types";
import { GitHub } from "arctic";

// 定义环境变量数据结构
export interface Env {
    D1: D1Database;
    GITHUB_ID: string;
    GITHUB_SECRET: string;
}

export function initializeLucia(env: Env) {
    const adapter = new D1Adapter(env.D1, {
        user: "user",
        session: "session"
    });

    const lucia = new Lucia(adapter, {
        sessionCookie: {
            attributes: {
                secure: true
            }
        },
        getUserAttributes: (attributes) => {
            return {
                // attributes has the type of DatabaseUserAttributes
                githubId: attributes.github_id,
                username: attributes.username
            };
        }
    });

    return lucia;
}

// 定义Github认证初始化函数
export function initializeGitHub(env: Env) {
    return new GitHub(
        env.GITHUB_ID,
        env.GITHUB_SECRET
    );
}

// 定义用户属性接口
interface DatabaseUserAttributes {
    github_id: number;
    username: string;
}

// 声明Lucia模块
declare module "lucia" {
    interface Register {
        Lucia: ReturnType<typeof initializeLucia>;
        DatabaseUserAttributes: DatabaseUserAttributes;
    }
}
