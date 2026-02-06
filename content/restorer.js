/*
  Restorer Logic
  Minimal fallback for legacy tab-based method.
  Main branching now happens in-tab via injector.js
*/

async function checkAndRestore() {
    try {
        const data = await chrome.storage.local.get("branchPendingData");
        if (!data || !data.branchPendingData) return;

        const chatData = data.branchPendingData;
        await chrome.storage.local.remove("branchPendingData");
        await restoreBranch(chatData);
    } catch (err) {
        console.error("Restoration error", err);
    }
}

async function restoreBranch(chatData) {
    const cleanTitle = (chatData.title || "Chat").replace(/^Google Gemini\s*[-–—]?\s*/i, '').trim() || "Chat";
    const branchName = `Branch: ${cleanTitle}`;
    const instruction = `Process the chat history. Respond with: 'I have processed the conversation. We are now in a new Branch of the chat.'`;

    if (!chatData.items) chatData.items = [];
    chatData.items.push({ user: instruction });

    const orderedItems = chatData.items.map(item => ({
        ...(item.user !== undefined && { user: item.user }),
        ...(item.assistant !== undefined && { assistant: item.assistant })
    }));

    const orderedChatData = {
        format: "gemini-voyager.chat.v1",
        url: chatData.url || window.location.href,
        exportedAt: new Date().toISOString(),
        count: orderedItems.length,
        title: branchName,
        items: orderedItems
    };

    const file = new File([JSON.stringify(orderedChatData, null, 2)], "Transferred Context.json", { type: "application/json" });

    await new Promise(r => setTimeout(r, 1000));

    // Use drag/drop (no overlay, simple fallback)
    const textArea = document.querySelector('[role="textbox"], div[contenteditable="true"], textarea, rich-textarea');
    if (textArea) {
        const dt = new DataTransfer();
        dt.items.add(file);
        const dropTarget = textArea.parentElement || document.body;

        ['dragenter', 'dragover'].forEach(type => {
            dropTarget.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt, view: window }));
        });
        await new Promise(r => setTimeout(r, 100));
        dropTarget.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt, view: window }));

        if (textArea.textContent === "") {
            textArea.focus();
            document.execCommand('insertText', false, ' ');
            textArea.dispatchEvent(new Event('input', { bubbles: true }));
        }

        await new Promise(r => setTimeout(r, 1500));

        const sendBtn = document.querySelector('button[aria-label^="Send"], button.send-button, button[aria-label*="Send"]');
        if (sendBtn && !sendBtn.disabled) sendBtn.click();
    }
}

setTimeout(checkAndRestore, 500);
