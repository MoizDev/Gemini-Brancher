const BRANCH_ICON_SVG = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" style="transform: rotate(180deg);">
  <path d="M14 4L16.29 6.29L13.41 9.17L14.83 10.59L17.71 7.71L20 10V4H14ZM10 4H4V10L6.29 7.71L11 12.41V20H13V11.59L7.71 6.29L10 4Z" fill="currentColor"/>
</svg>`;

// Debounce utility
function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

// Overlay management - ensure only one at a time
let currentOverlay = null;

function showOverlay(message, subtitle = "") {
  // Remove any existing overlay first
  if (currentOverlay) {
    currentOverlay.remove();
    currentOverlay = null;
  }

  const existing = document.getElementById('gemini-branch-overlay');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.id = 'gemini-branch-overlay';

  let logoUrl = "";
  try {
    logoUrl = chrome.runtime.getURL('icons/icon48.png');
  } catch (e) { }

  // Always include subtitle structure so scraper can update message count
  overlay.innerHTML = `
    <div class="overlay-icon">${logoUrl ? `<img src="${logoUrl}" alt="">` : '🔄'}</div>
    <div class="overlay-content">
      <div class="overlay-title">${message}</div>
      <div class="overlay-subtitle">${subtitle || '<span class="message-count">0</span> messages loaded'}</div>
    </div>
  `;
  document.body.appendChild(overlay);
  currentOverlay = overlay;
  return overlay;
}

function updateOverlay(message) {
  const overlay = document.getElementById('gemini-branch-overlay');
  if (overlay) {
    const title = overlay.querySelector('.overlay-title');
    if (title) title.textContent = message;
  }
}

async function closeOverlay() {
  const overlay = document.getElementById('gemini-branch-overlay');
  if (overlay) {
    overlay.classList.add('closing');
    await new Promise(r => setTimeout(r, 100));
    overlay.remove();
  }
  currentOverlay = null;
}

// Main injection logic
function injectButtons() {
  const copyButtons = document.querySelectorAll('copy-button');

  copyButtons.forEach(copyBtn => {
    const toolbar = copyBtn.closest('.buttons-container-v2') || copyBtn.closest('.actions-container-v2') || copyBtn.parentElement;
    if (!toolbar) return;
    if (toolbar.querySelector('.gemini-branch-btn')) return;

    const btn = document.createElement('button');
    btn.className = 'gemini-branch-btn';
    btn.innerHTML = BRANCH_ICON_SVG;
    btn.setAttribute('aria-label', 'Branch this conversation');
    btn.setAttribute('data-tooltip', 'Branch this conversation');
    btn.title = "";

    btn.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      handleBranchClick(btn, toolbar);
    });

    if (copyBtn.nextSibling) {
      toolbar.insertBefore(btn, copyBtn.nextSibling);
    } else {
      toolbar.appendChild(btn);
    }
  });
}

async function handleBranchClick(btn, toolbar) {
  if (btn.classList.contains('loading')) return;
  btn.classList.add('loading');

  try {
    const originalTitle = document.title.replace(/^Google Gemini\s*[-–—]?\s*/i, '').trim() || "Chat";
    showOverlay("Preparing branch...", `from "${originalTitle}"`);

    // Hydrate and extract chat
    const hydrateResult = await window.GeminiScraper.hydrateChat();

    // Check if user cancelled
    if (hydrateResult && hydrateResult.aborted) {
      btn.classList.remove('loading');
      return; // Stop the entire branch process
    }

    const allButtons = Array.from(document.querySelectorAll('.gemini-branch-btn'));
    const btnIndex = allButtons.indexOf(btn);
    if (btnIndex === -1) throw new Error("Could not identify button index");

    const chatData = window.GeminiScraper.extractChat({ index: btnIndex });

    // Create the JSON file
    const branchName = `Branch: ${originalTitle}`;
    const instruction = `Process the chat history and absorb ALL context completely. User has branched off into a new chat. You MUST name this chat Branch: ${branchName}. Do NOT summarize the chat. Do NOT mention you read the file. Respond with EXACTLY and ONLY this sentence: 'I have processed the conversation. We are now in ${branchName}'`;

    if (!chatData.items) chatData.items = [];
    chatData.items.push({ user: instruction });

    const orderedItems = chatData.items.map(item => {
      const ordered = {};
      if (item.user !== undefined) ordered.user = item.user;
      if (item.assistant !== undefined) ordered.assistant = item.assistant;
      return ordered;
    });

    const orderedChatData = {
      format: "gemini-voyager.chat.v1",
      url: chatData.url || window.location.href,
      exportedAt: new Date().toISOString(),
      count: orderedItems.length,
      title: branchName,
      items: orderedItems
    };

    const jsonString = JSON.stringify(orderedChatData, null, 2);
    const file = new File([jsonString], "Transferred Context.json", { type: "application/json" });

    // Store file for after navigation
    window._branchPendingFile = file;
    window._branchPendingTitle = branchName;

    updateOverlay("Opening new chat...");

    // Navigate to new chat - click sidebar button
    const newChatBtn = document.querySelector(
      'a[href="/app"], a[href*="/app?"], button[aria-label*="New chat"], ' +
      '[data-test-id="new-chat"], .new-chat-button, a[aria-label*="New chat"]'
    );

    if (newChatBtn) {
      newChatBtn.click();
    } else {
      // Fallback: keyboard shortcut
      const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
      const keyEvent = new KeyboardEvent('keydown', {
        key: 'o',
        code: 'KeyO',
        keyCode: 79,
        shiftKey: true,
        metaKey: isMac,
        ctrlKey: !isMac,
        bubbles: true
      });
      document.dispatchEvent(keyEvent);
    }

    // Wait for navigation then upload
    setTimeout(async () => {
      await performUpload();
    }, 400);

  } catch (err) {
    console.error("Branching Exception:", err);
    await closeOverlay();
    alert("Branching failed: " + err.message);
    btn.classList.remove('loading');
  }
}

// Perform upload - try multiple methods for reliability
async function performUpload() {
  const file = window._branchPendingFile;
  if (!file) {
    await closeOverlay();
    return;
  }

  window._branchPendingFile = null;
  window._branchPendingTitle = null;

  try {
    updateOverlay("Uploading context...");

    // Wait for new chat UI
    await new Promise(r => setTimeout(r, 200));

    // Find the text area
    const textArea = document.querySelector('[role="textbox"], div[contenteditable="true"], textarea, rich-textarea');

    if (!textArea) {
      updateOverlay("Error: Input not found");
      await new Promise(r => setTimeout(r, 1500));
      await closeOverlay();
      return;
    }

    let uploaded = false;

    // Strategy 1: Find existing hidden file input (doesn't open Finder)
    const fileInput = findFileInputDeep();
    if (fileInput) {
      const dt = new DataTransfer();
      dt.items.add(file);

      const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'files');
      if (descriptor && descriptor.set) {
        descriptor.set.call(fileInput, dt.files);
      } else {
        fileInput.files = dt.files;
      }

      fileInput.dispatchEvent(new Event('change', { bubbles: true }));
      fileInput.dispatchEvent(new Event('input', { bubbles: true }));
      uploaded = true;
    }

    // Strategy 2: Clipboard paste
    if (!uploaded) {
      try {
        const dt = new DataTransfer();
        dt.items.add(file);

        textArea.focus();
        const pasteEvent = new ClipboardEvent('paste', {
          bubbles: true,
          cancelable: true,
          clipboardData: dt
        });
        textArea.dispatchEvent(pasteEvent);
        uploaded = true;
      } catch (e) {
        // Clipboard paste failed, try drag/drop
      }
    }

    // Strategy 3: Drag and drop (last resort)
    if (!uploaded) {
      const dt = new DataTransfer();
      dt.items.add(file);

      const dropTarget = textArea.closest('[class*="input-area"]') ||
        textArea.closest('[class*="input"]') ||
        textArea.parentElement?.parentElement ||
        textArea.parentElement ||
        document.body;

      // Need to dispatch to the document for Gemini to catch it
      const events = [
        new DragEvent('dragenter', { bubbles: true, cancelable: true, dataTransfer: dt }),
        new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }),
      ];

      events.forEach(e => document.body.dispatchEvent(e));
      await new Promise(r => setTimeout(r, 50));

      document.body.dispatchEvent(new DragEvent('drop', {
        bubbles: true,
        cancelable: true,
        dataTransfer: dt
      }));
    }

    // Wait for file to be attached - simple approach
    updateOverlay("Uploading file...");

    const startTime = Date.now();
    const maxWait = 30000; // 30 second max
    let fileAttached = false;

    while (Date.now() - startTime < maxWait) {
      await new Promise(r => setTimeout(r, 200));

      // Check for file preview container
      const hasPreview = document.querySelector(
        'uploader-file-preview-container, ' +
        '.file-preview-chip, ' +
        '[class*="file-preview"]'
      );

      // Or check for our filename in page
      const pageText = document.body.innerText || '';
      const hasFilename = pageText.includes('Transferred Context') || pageText.includes('Context.json');

      if (hasPreview || hasFilename) {
        fileAttached = true;
        break;
      }
    }

    if (fileAttached) {
      // Wait a moment for processing to complete
      updateOverlay("Processing...");
      await new Promise(r => setTimeout(r, 1000));

      // Helper to check if send button is enabled
      const isSendEnabled = (btn) => {
        if (!btn) return false;
        // Gemini uses aria-disabled="true" not the disabled attribute
        if (btn.getAttribute('aria-disabled') === 'true') return false;
        if (btn.disabled) return false;
        // Also check parent container for disabled class
        const container = btn.closest('.send-button-container');
        if (container && container.classList.contains('disabled')) return false;
        return true;
      };

      // Poll for send button to be enabled (max 10 seconds)
      updateOverlay("Waiting to send...");
      const sendStartTime = Date.now();
      let sent = false;

      while (Date.now() - sendStartTime < 10000) {
        const sendBtn = document.querySelector('button[aria-label^="Send"], button.send-button, button[aria-label*="Send"]');

        if (isSendEnabled(sendBtn)) {
          updateOverlay("Sending...");
          sendBtn.click();
          updateOverlay("Done!");
          await new Promise(r => setTimeout(r, 150));
          sent = true;
          break;
        }

        await new Promise(r => setTimeout(r, 200));
      }

      if (!sent) {
        updateOverlay("Please send manually");
        await new Promise(r => setTimeout(r, 800));
      }
    } else {
      // File not attached - do NOT send (would just send empty space)
      updateOverlay("Still uploading - send when ready");
      await new Promise(r => setTimeout(r, 2000));
    }

    await closeOverlay();

    // Remove loading state from all buttons
    document.querySelectorAll('.gemini-branch-btn.loading').forEach(b => b.classList.remove('loading'));

  } catch (err) {
    console.error("Upload error:", err);
    updateOverlay("Error");
    await new Promise(r => setTimeout(r, 500));
    await closeOverlay();
  }
}

// Helper to search through Shadow DOMs for file input
function findFileInputDeep(root = document.body) {
  let el = root.querySelector('input[type="file"]');
  if (el) return el;

  const children = root.querySelectorAll('*');
  for (const child of children) {
    if (child.shadowRoot) {
      el = findFileInputDeep(child.shadowRoot);
      if (el) return el;
    }
  }
  return null;
}

// Observe and inject
const observer = new MutationObserver(debounce(() => {
  injectButtons();
}, 500));

observer.observe(document.body, { childList: true, subtree: true });
setTimeout(injectButtons, 1000);
