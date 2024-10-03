import { SignJWT } from 'jose';
import type { JWTPayload } from 'jose';


// const secret = new TextEncoder().encode('YOUR_SECRET_KEY'); // 替换为你自己的安全密钥

export async function createJWT(payload: JWTPayload, secret_key: string, expiresIn: string = '1h') {
  const secret = new TextEncoder().encode(secret_key);
  return new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuedAt()
    .setExpirationTime(expiresIn)
    .sign(secret);
}
