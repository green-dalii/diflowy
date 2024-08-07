import { SignJWT, jwtVerify } from 'jose';
import type { JWTPayload } from 'jose';

const secret = new TextEncoder().encode('YOUR_SECRET_KEY'); // 替换为你自己的安全密钥

export async function createJWT(payload: JWTPayload, expiresIn: string = '1h') {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuedAt()
    .setExpirationTime(expiresIn)
    .sign(secret);
}

export async function verifyJWT(token: string) {
  try {
    const { payload } = await jwtVerify(token, secret);
    return payload;
  } catch (e) {
    throw new Error('Invalid token');
  }
}
