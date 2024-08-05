// src/contexts/AuthContext.tsx
import React, { createContext, useState, useContext, useEffect } from 'react';
import type { ReactNode } from 'react';

interface User {
    id: string;
    username: string;
    // 添加其他用户属性
}

interface UserData {
    authenticated: boolean;
    user: User | null;
}

// 定义上下文类型
interface AuthContextType {
    user: User | null;
    loading: boolean;
    error: string | null;
    login: () => void;
    logout: () => Promise<void>;
    checkAuth: () => Promise<void>;
}

// 创建上下文
const AuthContext = createContext<AuthContextType | undefined>(undefined);

// 创建 AuthProvider 组件
interface AuthProviderProps {
    children: ReactNode;
}

// 导出 AuthProvider 组件
export const AuthProvider: React.FC<AuthProviderProps> = ({ children }) => {
    console.log('AuthProvider rendered');
    // 定义状态
    const [user, setUser] = useState<User | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    // 检查用户身份
    const checkAuth = async () => {
        console.log('Checking user authentication...');
        try {
            setLoading(true);
            const response = await fetch('/api/user');
            const data: UserData = await response.json();
            console.log('Fetched user data>>>', data);
            if (data.authenticated) {
                setUser(data.user);
            } else {
                setUser(null);
            }
        } catch (err) {
            console.log('Failed to fetch user data');
            setError('Failed to fetch user data');
            setUser(null);
        } finally {
            setLoading(false);
        }
    };

    // 登录函数
    const login = () => {
        // 重定向到 GitHub OAuth 登录页面
        window.location.href = '/api/auth/github';
    };

    // 登出函数
    const logout = async () => {
        try {
            await fetch('/api/auth/logout', { method: 'POST' });
            setUser(null);
        } catch (err) {
            setError('Failed to logout');
        }
    };

    // 检查用户身份
    useEffect(() => {
        checkAuth();
    }, []);

    return (
        <AuthContext.Provider value={{ user, loading, error, login, logout, checkAuth }}>
            {children}
        </AuthContext.Provider>
    );
};

// 导出 useAuth 钩子
export const useAuth = () => {
    const context = useContext(AuthContext);
    if (context === undefined) {
        console.log('useAuth must be used within an AuthProvider');
        return {
            user: null,
            loading: false,
            error: 'AuthProvider not found',
            login: () => {},
            logout: async () => {},
            checkAuth: async () => {},
        };
    }
    console.log('useAuth hook called with user:', context.user);
    return context;
};