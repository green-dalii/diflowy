import { Lucia } from "lucia";
import { D1Adapter } from "@lucia-auth/adapter-sqlite";
import { D1Database } from "@cloudflare/workers-types";
import { GitHub } from "arctic";

export const github = new GitHub(
	context.env.GITHUB_ID,
	context.env.GITHUB_SECRET
);

// 创建Lucia实例
export function initializeLucia(D1: D1Database) {
	const adapter = new D1Adapter(D1, {
		user: "user",
		session: "session"
	});

	const lucia = new Lucia(adapter, {
        sessionCookie: {
          attributes: {
            secure: context.env.AUTH_SECRET
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
