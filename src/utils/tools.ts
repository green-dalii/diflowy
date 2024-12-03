// Workflow Data Structure
export interface Workflow {
    id: string;
    name: string;
    icon: string;
    isPrivate: number;
    description: string;
    tags: string;
    latestVersion: string;
    authorData: string;
    workspace_id: string | null;
    user_id: string;
}

// Workflows Response Data Structure
export interface GetWorkflowsResponse {
    workflows: Workflow[];
    total: number;
    page: number;
    pageSize: number;
}

// User Info Response Data Structure
export interface GetUserInfoResponse {
    user: {
        id: string;
        username: string;
        plan_type: string;
        expired: boolean;
        message: string;
    };
}

// User Details Response Data Structure
export interface GetUserDetailsResponse {
    user: {
        id: string;
        username: string;
        created_at: string;
        plan_type: string;
        plan_started_at: string;
        plan_expired_at: string;
    }
}

// Joined Workspace Data Structure
export interface JoinedWorkspace {
    id: string;
    name: string;
    owner_id: string;
    role: string;
    created_at: string;
}

// Managed Workspace Data Structure
export interface ManagedWorkspaces {
    id: string;
    name: string;
    owner_id: string;
    created_at: string;
    member_count: number;
}

// Workspaces Response Data Structure
export interface GetWorkspacesResponse {
    user: {
        id: string;
        username: string;
        plan_type: string;
        expired: boolean;
        message: string;
    };
    workspacesObject: {
        joined: {
            workspaces: JoinedWorkspace[];
            total: number;
        };
        managed: {
            workspaces: ManagedWorkspaces[];
            total: number;
            total_member_count: number;
        };
    }
}

// Members in workspace Data Structure
export interface Members {
    id: string;
    username: string;
    role: string;
    joined_at: string;
}

// Specific Workspace Data Structure
export interface WorkspaceResponse {
    id: string;
    name: string;
    owner_id: string;
    created_at: string;
    members: Members[];
}

// invite token Data Structure
export interface InviteTokenResponse {
    res: string;
}

// join workspace Data Structure
export interface JoinWorkspaceResponse {
    res: string;
}

// 自定义错误类
class CustomError extends Error {
    constructor(message: string) {
        super(message);
        this.name = this.constructor.name;
        Error.captureStackTrace(this, this.constructor);
    }
}

export class JWTError extends CustomError {
    constructor(message: string) {
        super(message);
        this.message = message || "Authentication failed";
    }
}

// Skeleton in workflowgrid
export function skeleton() {
    return `
    <div class="border dark:border-[--darkbgoffset] shadow rounded-3xl p-4 w-full mx-auto h-52">
    <div class="animate-pulse grid grid-cols-1 content-between h-full">
        <div class="flex flex-row space-x-4 items-center">
            <div class="flex-none rounded-full bg-slate-200 dark:bg-[--darkbgoffset] h-12 w-12"></div>
            <div class="flex-grow h-8 bg-slate-200 dark:bg-[--darkbgoffset] rounded-full"></div>
        </div>
        <div class="flex-1 space-y-4 py-1">
            <div class="ml-16 space-y-3">
                <div class="h-2 bg-slate-200 dark:bg-[--darkbgoffset] rounded"></div>
                <div class="grid grid-cols-3 gap-4">
                    <div class="h-2 bg-slate-200 dark:bg-[--darkbgoffset] rounded col-span-2"></div>
                    <div class="h-2 bg-slate-200 dark:bg-[--darkbgoffset] rounded col-span-1"></div>
                </div>
                <div class="h-2 bg-slate-200 dark:bg-[--darkbgoffset] rounded"></div>
            </div>
        </div>
    </div>
</div>
    `
}

// update pagination component
export function updatePagination(
    total: number,
    currentPage: number,
    pageSize: number,
    loadPageData: (page: number) => void
) {
    const totalPages = Math.ceil(total / pageSize); // 计算总页数
    const paginationDiv = document.getElementById(
        "pagination",
    ) as HTMLDivElement;
    paginationDiv.innerHTML = ""; // 清空之前的内容

    // 创建分页按钮
    function createPageButton(page: number, isDisabled = false) {
        const button = document.createElement("button");
        button.className = `join-item btn ${isDisabled ? "btn-disabled" : ""}`;
        button.textContent = page.toString();
        button.disabled = isDisabled;
        if (!isDisabled) {
            button.addEventListener("click", () => {
                loadPageData(page); // 点击按钮加载对应页数据
            });
        }
        return button;
    }

    // add page 1 button
    paginationDiv.appendChild(createPageButton(1, currentPage === 1));

    // add ... button
    if (currentPage > 3) {
        const ellipsis = document.createElement("button");
        ellipsis.className = "join-item btn btn-disabled";
        ellipsis.textContent = "...";
        paginationDiv.appendChild(ellipsis);
    }

    // add nearby button
    for (
        let i = Math.max(2, currentPage - 1);
        i <= Math.min(totalPages - 1, currentPage + 1);
        i++
    ) {
        paginationDiv.appendChild(createPageButton(i, currentPage === i));
    }

    // add ... button
    if (currentPage < totalPages - 2) {
        const ellipsis = document.createElement("button");
        ellipsis.className = "join-item btn btn-disabled";
        ellipsis.textContent = "...";
        paginationDiv.appendChild(ellipsis);
    }

    // add last page button
    if (totalPages > 1) {
        paginationDiv.appendChild(
            createPageButton(totalPages, currentPage === totalPages),
        );
    }
}

// Get workflows from API
export async function fetchWorkflows(
    page: number = 1,
    pageSize: number = 12,
    tags: string[] = [],
    myflow: string = "no",
    isPrivate: string = "no"
): Promise<GetWorkflowsResponse> {
    const url = new URL("/api/workflow/filter", window.location.origin);
    url.searchParams.append("page", page.toString());
    url.searchParams.append("pageSize", pageSize.toString());
    url.searchParams.append("myflow", myflow);
    url.searchParams.append("isPrivate", isPrivate);
    tags.forEach((tag) => url.searchParams.append("tags", tag));
    console.log("Fetching workflows from:", url.toString());
    const response = await fetch(url.toString());

    if (response.status == 401) {
        console.error("JWT Expired");
        throw new Error("JWT Expired");
    } else if (response.status === 403) {
        console.error("Forbidden to fetch workflows");
        throw new Error("Forbidden");
    }
    else if (!response.ok) {
        console.error("Failed to fetch workflows:", response.statusText);
        throw new Error("Failed to fetch workflows");
    }
    return (await response.json()) as GetWorkflowsResponse;
}

// Get tags[] from url
export function getTagsFromURL(): string[] {
    const urlParams = new URLSearchParams(window.location.search);
    const tags: string[] = urlParams.getAll("tags");
    return tags;
}

// Function to format the update time in a human-readable format
export function formatUpdateTime(updateTime: string): string {
    const now = new Date();
    const updated = new Date(updateTime);
    const diff = now.getTime() - updated.getTime();

    const seconds = Math.floor(diff / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    const months = Math.floor(days / 30);
    const years = Math.floor(months / 12);

    if (years > 0) {
        return `${years} year${years > 1 ? 's' : ''} ago`;
    } else if (months > 0) {
        return `${months} month${months > 1 ? 's' : ''} ago`;
    } else if (days > 0) {
        return `${days} day${days > 1 ? 's' : ''} ago`;
    } else if (hours > 0) {
        return `${hours} hour${hours > 1 ? 's' : ''} ago`;
    } else if (minutes > 0) {
        return `${minutes} minute${minutes > 1 ? 's' : ''} ago`;
    } else {
        return `${seconds} second${seconds > 1 ? 's' : ''} ago`;
    }
}

// Get User Info
export async function fetchUserInfo(): Promise<GetUserInfoResponse> {
    const url = new URL("/api/user", window.location.origin);
    const response = await fetch(url.toString());
    if (response.status == 401) {
        console.error("JWT Expired");
        throw new Error("JWT Expired");
    } else if (response.status === 404) {
        console.error("No User Found");
        throw new Error("Not Found");
    }
    else if (!response.ok) {
        console.error("Failed to fetch userinfo", response.statusText);
        throw new Error("Failed to fetch userinfo");
    }
    return (await response.json()) as GetUserInfoResponse;
}

// Get User detail info
export async function fetchUserDetails(): Promise<GetUserDetailsResponse> {
    const url = new URL("/api/user?detail=true", window.location.origin);
    const response = await fetch(url.toString());
    if (response.status == 401) {
        console.error("JWT Expired");
        throw new Error("JWT Expired");
    } else if (response.status === 404) {
        console.error("No User Found");
        throw new Error("Not Found");
    }
    else if (!response.ok) {
        console.error("Failed to fetch userinfo", response.statusText);
        throw new Error("Failed to fetch userinfo");
    }
    return (await response.json()) as GetUserDetailsResponse;
}

// Get User Workspace info
export async function fetchUserWorkspaces(): Promise<GetWorkspacesResponse> {
    const url = new URL("/api/user/workspace", window.location.origin);
    const response = await fetch(url.toString());
    if (response.status == 401) {
        console.error("JWT Expired");
        throw new Error("JWT Expired");
    } else if (response.status === 404) {
        console.error("No User Found");
        throw new Error("Not Found");
    }
    else if (!response.ok) {
        console.error("Failed to fetch userinfo", response.statusText);
        throw new Error("Failed to fetch userinfo");
    }
    return (await response.json()) as GetWorkspacesResponse;
}

// Get specific workspace data
export async function fetchSpecificWorkspace(workspace_id: string): Promise<WorkspaceResponse> {
    const url = new URL("/api/user/workspace/" + workspace_id, window.location.origin);
    const response = await fetch(url.toString());
    if (response.status == 401) {
        console.error("JWT Expired");
        throw new Error("JWT Expired");
    } else if (response.status === 404) {
        console.error("No workspace Found");
        throw new Error("Not Found");
    }
    else if (!response.ok) {
        console.error("Failed to fetch workspace", response.statusText);
        throw new Error("Failed to fetch workspace");
    }
    return (await response.json()) as WorkspaceResponse;
}