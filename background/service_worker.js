/*
  Background Service Worker
  Minimal - main logic now happens in-tab via injector.js
  Kept for backwards compatibility and potential future features
*/

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "BRANCH_INIT") {
        // Legacy support - save data and open new tab
        handleBranchInit(request.data)
            .then(() => sendResponse({ status: "success" }))
            .catch(err => sendResponse({ status: "error", message: err.message }));
        return true;
    }
});

async function handleBranchInit(chatData) {
    // Save data for legacy restorer
    await chrome.storage.local.set({ branchPendingData: chatData });

    // Extract account path from source URL
    const sourceUrl = chatData.url || "";
    const accountMatch = sourceUrl.match(/\/u\/(\d+)\//);
    const accountPath = accountMatch ? `/u/${accountMatch[1]}` : "";

    // Open new tab (legacy method)
    await chrome.tabs.create({ url: `https://gemini.google.com${accountPath}/app` });
}
