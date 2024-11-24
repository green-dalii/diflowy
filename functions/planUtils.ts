import type { Env } from './api/auth';

interface CheckUserPlanResult {
    plan_type: string;
    expired: boolean;
    message: string;
}

interface queryResult {
    id: string;
    username: string;
    created_at: string;
    plan_type: string;
    plan_started_at: string;
    plan_expired_at: string;
}

export async function checkUserPlan(userId: string, env: Env) {
    // Get user plan information
    const userQuery = await env.D1.prepare(
        "SELECT plan_type, plan_expired_at FROM users WHERE id = ?"
    ).bind(userId).first() as queryResult;

    if (!userQuery) {
        throw new Error('User not found');
    }

    const { plan_type, plan_expired_at } = userQuery;

    // Convert plan_expired_at to Date object
    const expiredAtDate = new Date(plan_expired_at);
    const currentTime = new Date();

    // Check if plan is expired
    if (expiredAtDate < currentTime) {
        // If plan is expired, downgrade to FREE
        await env.D1.prepare(
            "UPDATE users SET plan_type =? WHERE id = ?"
        ).bind('FREE', userId).run();

        return {
            plan_type: 'FREE',
            expired: true,
            message: 'Plan expired, downgraded to FREE'
        };
    }

    // Check if plan is FREE
    if (plan_type === 'FREE') {
        return {
            plan_type: 'FREE',
            expired: false,
            message: 'Plan is FREE, cannot perform this action'
        };
    }

    return {
        plan_type: plan_type,
        expired: false,
        message: 'Plan is valid'
    };
}