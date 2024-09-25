interface Workflow {
    id: string;
    name: string;
    icon: string;
    description: string;
    tags: string;
  }

  interface GetWorkflowsResponse {
    workflows: Workflow[];
    total: number;
    page: number;
    pageSize: number;
  }


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
async function fetchWorkflows(
    page: number = 1,
    pageSize: number = 12,
    tags: string[] = [],
): Promise<GetWorkflowsResponse> {
    const url = new URL("/api/workflow/filter", window.location.origin);
    url.searchParams.append("page", page.toString());
    url.searchParams.append("pageSize", pageSize.toString());
    tags.forEach((tag) => url.searchParams.append("tags", tag));
    console.log("Fetching workflows from:", url.toString());
    const response = await fetch(url.toString());

    if (!response.ok) {
        console.error("Failed to fetch workflows");
        // modalTitle.innerText = "⚠️ Error";
        // modalContent.innerText =
        //     "Failed to fetch workflows. Please check your connection and try again.";
        // modal.showModal();
    }
    return (await response.json()) as GetWorkflowsResponse;
}