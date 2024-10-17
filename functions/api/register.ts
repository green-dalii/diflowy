// /functions/api/auth/register.ts

import type { EventContext } from "@cloudflare/workers-types";
import { generateIdFromEntropySize } from "lucia";
import bcrypt from "bcryptjs";
import { createJWT } from "../jwtUtils";
import type { Env } from "./auth";

interface RegisterRequestBody {
  email: string;
  password: string;
  username?: string;
}

export const onRequestPost: (context: EventContext<Env, any, Record<string, unknown>>) => Promise<Response> = async (context): Promise<Response> => {
  try {
    // 解析请求体
    const body: RegisterRequestBody = await context.request.json();
    const { email, password, username } = body;

    // 基本验证
    if (!email || !password) {
      return new Response(JSON.stringify({ error: "Email and password are required" }), {
        status: 400,
        headers: { "Content-Type": "application/json" }
      });
    }

    // 验证邮箱格式
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return new Response(JSON.stringify({ error: "Invalid email format" }), {
        status: 400,
        headers: { "Content-Type": "application/json" }
      });
    }

    // 验证密码强度（至少8个字符，包含数字和字母）
    const passwordRegex = /^(?=.*[A-Za-z])(?=.*\d)[A-Za-z\d]{8,}$/;
    if (!passwordRegex.test(password)) {
      return new Response(JSON.stringify({ 
        error: "Password must be at least 8 characters long and contain both letters and numbers" 
      }), {
        status: 400,
        headers: { "Content-Type": "application/json" }
      });
    }

    // 检查邮箱是否已存在
    const { results } = await context.env.D1.prepare(
      "SELECT * FROM users WHERE email = ?"
    ).bind(email).all();

    if (results.length > 0) {
      return new Response(JSON.stringify({ error: "Email already registered" }), {
        status: 400,
        headers: { "Content-Type": "application/json" }
      });
    }

    // 生成密码哈希
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    // 生成用户ID
    const userId = generateIdFromEntropySize(10);

    // 生成用户名（如果未提供）
    const finalUsername = username || email.split("@")[0];

    // 将用户信息存入数据库
    await context.env.D1.prepare(
      "INSERT INTO users (id, email, password_hash, username) VALUES (?, ?, ?, ?)"
    ).bind(userId, email, hashedPassword, finalUsername).run();

    // 创建JWT
    const userPayload = {
      id: userId,
      username: finalUsername,
      email: email,
      provider: 'email'
    };

    const token = await createJWT(userPayload, context.env.AUTH_SECRET);

    // 设置cookie
    const response = new Response(JSON.stringify({ 
      success: true, 
      user: { 
        id: userId, 
        username: finalUsername, 
        email 
      } 
    }), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Set-Cookie": `auth_token=${token}; HttpOnly; Secure; Path=/; Max-Age=3600`
      }
    });

    return response;

  } catch (e) {
    console.error("Error in registration:", e);
    return new Response(JSON.stringify({ error: "Internal Server Error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }
};