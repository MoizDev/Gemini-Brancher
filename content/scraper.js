/*
  Scraper Logic
  Exposes window.GeminiScraper for the injector to use.
*/

window.GeminiScraper = window.GeminiScraper || {};

// Helper sleep function
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Scrolls to the top of the chat container to force lazy loading.
 * Enhanced version for large chats with aggressive hydration.
 * @param {Function} onProgress - Callback for status updates
 */
window.GeminiScraper.hydrateChat = async (onProgress) => {
    // 1. Find the correct scrollable container (the chat-history one, not disable-scroll)
    let scroller = document.querySelector('infinite-scroller.chat-history') ||
        document.querySelector('infinite-scroller[class*="chat"]') ||
        document.querySelector('.chat-history-scroll-container');

    // Fallback: find scrollable div containing messages
    if (!scroller) {
        const potentialScrollers = Array.from(document.querySelectorAll('div, infinite-scroller')).filter(el => {
            const style = window.getComputedStyle(el);
            const isScrollable = (style.overflowY === 'auto' || style.overflowY === 'scroll') && el.scrollHeight > el.clientHeight;
            const hasMessages = el.querySelector('message-content') || el.querySelector('user-query-content');
            return isScrollable && hasMessages;
        });
        scroller = potentialScrollers[0];
    }

    if (!scroller) {
        console.warn("Hydrate: Could not find scroll container. Using document.");
        scroller = document.documentElement;
    }


    // Count messages helper
    const countMessages = () => {
        return document.querySelectorAll('message-content, user-query-content').length;
    };

    // Use existing overlay if present (from injector), otherwise create one
    let overlay = document.getElementById('gemini-branch-overlay');
    let createdOverlay = false;

    if (!overlay) {
        // Create overlay only if none exists
        createdOverlay = true;
        overlay = document.createElement('div');
        overlay.id = 'gemini-branch-overlay';
        const logoUrl = chrome.runtime.getURL('icons/icon48.png');
        overlay.innerHTML = `
            <div class="overlay-icon"><img src="${logoUrl}" alt=""></div>
            <div class="overlay-content">
                <div class="overlay-title">Loading Chat History</div>
                <div class="overlay-subtitle">
                    <span class="message-count">${countMessages()}</span> messages loaded
                </div>
            </div>
            <button class="abort-btn" title="Cancel loading">✕</button>
        `;
        document.body.appendChild(overlay);
    } else {
        // Add abort button to existing overlay if not present
        if (!overlay.querySelector('.abort-btn')) {
            const abortBtn = document.createElement('button');
            abortBtn.className = 'abort-btn';
            abortBtn.title = 'Cancel loading';
            abortBtn.textContent = '✕';
            overlay.appendChild(abortBtn);
        }
    }

    const titleSpan = overlay.querySelector('.overlay-title');
    const subtitleEl = overlay.querySelector('.overlay-subtitle');

    // Update existing overlay to show hydration status
    if (titleSpan) titleSpan.textContent = "Loading Chat History";
    if (subtitleEl) subtitleEl.innerHTML = `<span class="message-count">${countMessages()}</span> messages loaded`;

    // Get countSpan AFTER updating innerHTML (so we get the new element)
    const countSpan = overlay.querySelector('.message-count');

    // Abort flag
    let aborted = false;
    const abortBtn = overlay.querySelector('.abort-btn');
    if (abortBtn) {
        abortBtn.onclick = () => {
            aborted = true;
            // Immediate visual feedback
            overlay.classList.add('cancelling');
            if (titleSpan) titleSpan.textContent = "Cancelling...";
            if (subtitleEl) subtitleEl.textContent = "Returning to chat";
            abortBtn.style.display = 'none';
            // Scroll to bottom immediately
            if (scroller) scroller.scrollTop = scroller.scrollHeight;
        };
    }

    let previousMessageCount = countMessages();
    let previousHeight = scroller.scrollHeight;
    let attemptsNoChange = 0;
    let totalScrolls = 0;
    const MAX_TOTAL_SCROLLS = 200;
    let isActivelyLoading = false;
    let hasLoadedAny = false; // Track if we've seen ANY loading happen

    // Helper to close overlay - only if we created it
    const closeOverlay = async () => {
        if (createdOverlay && overlay) {
            overlay.classList.add('closing');
            await sleep(100);
            overlay.remove();
        }
    };

    try {
        // Quick check: if already at top with VERY small chat, skip hydration entirely
        if (scroller.scrollTop === 0 && scroller.scrollHeight < window.innerHeight * 1.5) {
            if (titleSpan) titleSpan.textContent = "Ready!";
            await closeOverlay();
            return;
        }

        // Hydration loop
        while (totalScrolls < MAX_TOTAL_SCROLLS) {
            // Check for abort
            if (aborted) {
                // Wait a moment so user sees the cancelling state
                await sleep(300);
                break;
            }

            totalScrolls++;

            if (onProgress) onProgress("Scrolling...");

            // Scroll to absolute top
            scroller.scrollTop = 0;

            // Also try scrolling any parent containers
            let parent = scroller.parentElement;
            while (parent && parent !== document.body) {
                if (parent.scrollTop > 0) parent.scrollTop = 0;
                parent = parent.parentElement;
            }

            // First few iterations use longer wait to give network time to start
            // After that, use adaptive wait based on loading state
            let waitTime;
            if (totalScrolls <= 1) {
                waitTime = 600; // Give network time to respond initially
            } else if (isActivelyLoading) {
                waitTime = 600; // Actively loading - check reasonably often
            } else {
                waitTime = 300; // Seems stable - check quickly
            }
            await sleep(waitTime);

            const newMessageCount = countMessages();
            const newHeight = scroller.scrollHeight;

            if (countSpan) countSpan.textContent = newMessageCount;

            const heightChanged = Math.abs(newHeight - previousHeight) > 50;
            const messagesChanged = newMessageCount > previousMessageCount;

            if (heightChanged || messagesChanged) {
                attemptsNoChange = 0;
                isActivelyLoading = true;
                hasLoadedAny = true;
                previousHeight = newHeight;
                previousMessageCount = newMessageCount;
            } else {
                attemptsNoChange++;

                // Adaptive exit:
                // If we never loaded anything (small chat), exit quickly (2 checks)
                // If we did load something (large chat), verify a bit more (3 checks)
                const requiredNoChange = hasLoadedAny ? 3 : 2;

                if (scroller.scrollTop === 0 && attemptsNoChange >= requiredNoChange) {
                    break;
                }
            }
        }
        if (aborted) {
            // Return aborted status so caller can stop the branch process
            return { aborted: true };
        }

        const finalCount = countMessages();

        // Show completion briefly
        if (titleSpan) titleSpan.textContent = "History Loaded!";
        if (countSpan) countSpan.textContent = finalCount;
        await sleep(150);

    } finally {
        await closeOverlay();
    }

    return { aborted: false };
};

/**
 * Extracts the chat history into the JSON format.
 * @param {HTMLElement} cutoffNode - Optional. If provided, stops extraction after this node.
 */
window.GeminiScraper.extractChat = (cutoffNode) => {
    const items = [];

    // Select all message blocks.
    // Gemini structure changes, but usually:
    // User messages: have data-is-user="true" or specific classes.
    // Model messages: have specific model icons.

    // We will iterate through a common parent's children to maintain order.
    // Broad selector to capture rows.
    // Let's rely on the text content wrapper classes if possible.

    // Heuristic: explicit user query text usually in h1, h2 or specific query class
    // Model text in markdown renderer class.

    // Better approach: Look for the common message containers
    // user-message-segment, model-message-segment (hypothetical names)

    // Strategy: Find all elements that look like message bubbles.
    // Identifying User vs Model:
    // User usually has "You" or user avatar.
    // Model has Gemini logo.

    // Let's grab all rows that contain text.
    // We'll try to find the main list container first.
    const messageList = document.querySelector('infinite-scroller') || document.querySelector('main');

    if (!messageList) throw new Error("Could not find message list container");

    // Get all direct children or relevant message wrappers
    // We often have to dig deep. 
    // Let's use a TreeWalker or deep selector if rows aren't clear.

    // Alternative: Select by specific attributes usually found
    const messages = extractMessagesDetailed(messageList, cutoffNode);

    const result = {
        format: "gemini-voyager.chat.v1",
        url: window.location.href,
        exportedAt: new Date().toISOString(),
        count: messages.length,
        title: document.title || "Gemini Chat Export",
        items: messages
    };

    // Debug: Show actual JSON string order

    return result;
};

// Helper to clean text
function cleanText(text) {
    if (!text) return "";
    return text.replace(/<[^>]*>/g, "") // strip html
        .replace(/^(Show drafts|Regenerate|Modify|Google it|more_vert|volume_up|thumb_up|thumb_down|share|copy|Edit)/gm, "") // remove UI noise
        .trim();
}

/**
 * Robust "Voyager-style" Scraper - COMPONENT BASED STRATEGY
 * Drills down into rows to separate User and Model content.
 * @param {Object} cutoffInfo - { index: number } - The index of the button to stop at.
 */
function extractMessagesDetailed(root, cutoffInfo) {
    const results = [];

    // 1. Find the target button first
    let targetButton = null;
    let cutoffRow = null;
    let scrollContainer = null;

    if (cutoffInfo && typeof cutoffInfo.index === 'number') {
        const allButtons = document.querySelectorAll('.gemini-branch-btn');
        targetButton = allButtons[cutoffInfo.index];

        if (targetButton) {
            // Walk up from button to find the infinite-scroller ancestor AND the cutoff row
            let curr = targetButton;
            let lastBeforeScroller = null;
            let maxIterations = 100;

            while (curr && maxIterations-- > 0) {
                const tagName = curr.tagName ? curr.tagName.toUpperCase() : '';
                const className = curr.className || '';

                // Check if current element IS an infinite-scroller (the container we want)
                if (tagName === 'INFINITE-SCROLLER' || className.includes('infinite-scroller')) {
                    scrollContainer = curr;
                    cutoffRow = lastBeforeScroller;
                    break;
                }

                // Remember this element as potential cutoff row (last element before we hit the scroller)
                lastBeforeScroller = curr;

                // Check if we're inside a shadow root
                const rootNode = curr.getRootNode();
                if (rootNode instanceof ShadowRoot) {
                    const host = rootNode.host;
                    curr = host;
                    continue;
                }

                // Normal light DOM traversal
                if (curr.parentElement) {
                    curr = curr.parentElement;
                } else {
                    break;
                }
            }

            if (!scrollContainer) {
                console.warn("Scraper: WARNING - Could not find scroll container from button!");
            }
            if (!cutoffRow) {
                console.warn("Scraper: WARNING - Could not find cutoff row!");
            }
        }
    }

    // Fallback: if no button-based scroll container found, use generic querySelector
    if (!scrollContainer) {
        // Look specifically for chat-history class first (the correct one based on logs)
        scrollContainer = document.querySelector('infinite-scroller.chat-history') ||
            document.querySelector('infinite-scroller[class*="chat"]') ||
            document.querySelector('infinite-scroller') ||
            document.querySelector('main');
    }

    if (!scrollContainer) {
        console.error("Scraper: No scroll container found at all!");
        return [];
    }


    // 2. Get all rows and find the cutoff index
    const rows = Array.from(scrollContainer.children);
    let cutoffRowIndex = -1;
    if (cutoffRow) {
        cutoffRowIndex = rows.indexOf(cutoffRow);

        // If indexOf returned -1, the cutoffRow might be nested one level deeper
        // Try to find it by checking if cutoffRow is a descendant of any row
        if (cutoffRowIndex === -1) {
            for (let i = 0; i < rows.length; i++) {
                if (rows[i].contains(cutoffRow)) {
                    cutoffRowIndex = i;
                    break;
                }
            }
        }
    }


    // 4. Traversal Logic
    const USER_SELECTORS = [
        'user-query-content',
        '.user-query-bubble-with-background',
        '.query-text'
    ];

    const MODEL_SELECTORS = [
        'message-content', // <message-content> is the direct container of text in your HTML
        '.model-response-text',
        '.markdown'
    ];

    const hasMatch = (el, selectors) => selectors.some(s => el.matches(s) || el.classList.contains(s.replace('.', '')));

    let currentPair = {};
    let extractionState = {
        stopExtraction: false
    };

    // Recursive processor
    function processNode(node, depth) {
        if (extractionState.stopExtraction) return;
        // Guard against overly deep recursion or invalid nodes
        if (depth <= 0) return;

        // Match Check
        let type = 'unknown';
        // Note: Check if node itself is an element before checking matches
        if (node.nodeType === 1) { // Element Node
            if (hasMatch(node, USER_SELECTORS)) type = 'user';
            else if (hasMatch(node, MODEL_SELECTORS)) type = 'assistant';
        }

        // If it's a known type, process it as a unit (Atomic Message)
        if (type !== 'unknown') {
            handleAtomicMessage(node, type);
            // We do NOT recurse into an atomic message (we've consumed it)
            return;
        }

        // Dig Deeper - TRAVERSAL LOGIC
        // 1. Shadow DOM (Crucial for Gemini)
        if (node.shadowRoot) {
            const shadowChildren = Array.from(node.shadowRoot.children);
            shadowChildren.forEach(child => processNode(child, depth - 1));
        }

        // 2. Light DOM Children
        if (node.children && node.children.length > 0) {
            Array.from(node.children).forEach(child => processNode(child, depth - 1));
        }

        // 3. Slot assigned nodes (if applicable, though usually covered by shadow traversals of parent)
        if (node.tagName === 'SLOT') {
            const assigned = node.assignedNodes();
            assigned.forEach(child => processNode(child, depth - 1));
        }
    }

    function handleAtomicMessage(node, type) {
        if (extractionState.stopExtraction) return;

        const clone = node.cloneNode(true);
        // We can't easily clean a clone with shadow roots, so we rely on innerText.
        // innerText DOES approximate rendered text well.
        clone.querySelectorAll('button, svg, img, .tool-code-container').forEach(n => n.remove());
        const text = cleanText(clone.innerText);

        if (text) {
            if (type === 'user') {
                // Strict new pair for new user turns
                if (currentPair.user || currentPair.assistant) {
                    results.push(currentPair);
                    currentPair = {};
                }
                currentPair.user = text;
            } else if (type === 'assistant') {
                if (currentPair.assistant) currentPair.assistant += "\n\n" + text;
                else currentPair.assistant = text;
                currentPair.starred = false;
            }
        }
    }

    // 5. Run Traversal on Rows UP TO AND INCLUDING the cutoff row

    for (let i = 0; i < rows.length; i++) {
        if (extractionState.stopExtraction) break;

        // CUTOFF CHECK: Stop AFTER processing the cutoff row
        // We need to include the row with the button (it contains the message we branch from)
        if (cutoffRowIndex !== -1 && i > cutoffRowIndex) {
            break;
        }

        processNode(rows[i], 10);
    }

    // Helper to normalize pair order (user before assistant)
    function normalizePair(pair) {
        const normalized = {};
        if (pair.user) normalized.user = pair.user;
        if (pair.assistant) normalized.assistant = pair.assistant;
        if ('starred' in pair) normalized.starred = pair.starred;
        return normalized;
    }

    // Normalize all results
    const normalizedResults = results.map(normalizePair);

    // Push final pair (also normalized)
    if (currentPair.user || currentPair.assistant) {
        normalizedResults.push(normalizePair(currentPair));
    }

    return normalizedResults;
}

function extractLegacy(root) {
    return [];
}

function getMainRows() {
    // Identify the scroll container first
    const scrollContainer = document.querySelector('infinite-scroller') || document.querySelector('main');
    if (!scrollContainer) return [];

    // Children
    return Array.from(scrollContainer.children).filter(c => c.innerText.length > 0);
}
