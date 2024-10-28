export async function generateFileKey(userId: string, registrationTime: string, authSecret: string) {
    // 组合用户特定信息创建密钥材料
    const keyMaterial = `${userId}-${registrationTime}-${authSecret}`;
    const encoder = new TextEncoder();
    const data = encoder.encode(keyMaterial);
    
    // 使用 PBKDF2 派生密钥
    const baseKey = await crypto.subtle.importKey(
        "raw",
        data,
        "PBKDF2",
        false,
        ["deriveBits", "deriveKey"]
    );
    
    // 生成用于加密的 AES-GCM 密钥
    return await crypto.subtle.deriveKey(
        {
            name: "PBKDF2",
            salt: encoder.encode(authSecret.slice(0, 16)),
            iterations: 100000,
            hash: "SHA-256"
        },
        baseKey,
        { name: "AES-GCM", length: 256 },
        true,
        ["encrypt", "decrypt"]
    );
}

export async function encryptFile(content: Uint8Array, key: CryptoKey) {
    // 生成随机 IV
    const iv = crypto.getRandomValues(new Uint8Array(12));
    
    // 加密数据
    const encryptedContent = await crypto.subtle.encrypt(
        {
            name: "AES-GCM",
            iv: iv
        },
        key,
        content
    );
    
    // 组合 IV 和加密数据
    const result = new Uint8Array(iv.length + encryptedContent.byteLength);
    result.set(iv, 0);
    result.set(new Uint8Array(encryptedContent), iv.length);
    
    return result;
}

export async function decryptFile(encryptedData: Uint8Array, key: CryptoKey) {
    // 提取 IV
    const iv = encryptedData.slice(0, 12);
    const content = encryptedData.slice(12);
    
    // 解密数据
    const decryptedContent = await crypto.subtle.decrypt(
        {
            name: "AES-GCM",
            iv: iv
        },
        key,
        content
    );
    
    return new Uint8Array(decryptedContent);
}