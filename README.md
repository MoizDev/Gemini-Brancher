# GemBrancher 🌿  
**Branch Your Gemini Conversations with Full Context**

GemBrancher is a simple, effective Chrome Extension that adds "Git-like" branching to Google Gemini. 

**Note**: This is a "dumb" solution to a complex problem. Gemini doesn't officially support branching, so this extension brute-forces it by scraping your current DOM, dumping it into a JSON file, and feeding it back to a new chat instance. It's not magic—it's just automating the Copy/Paste/Context-loading workflow you'd do manually.

![GemBrancher Banner](icons/gembrancher%20icon.png)

## ✨ Features

- **📍 Branch from Any Message**: A new "branch" button appears on every message in your chat history.
- **🧠 Full Context Inheritance**: When you branch, the extension scrapes the *entire* conversation history up to that exact point.
- **⚡️ Smart Hydration**: Automatically scrolls and loads older messages to ensure nothing is missed (with a polite abort button if you change your mind).
- **📂 JSON Context Injection**: Context is uploaded as a structured JSON file to the new chat, forcing Gemini to "absorb" the history before continuing.
- **⤵︎ Auto-Naming**: Automatically prefixes branched chats with `⤵︎ Branch:` so you can easily track your conversation tree in the sidebar.
- **🏎️ Optimized Performance**: Smart waiting logic balances speed and reliability, even for massive chat histories.

## 🚀 Installation

Since this extension is in active development, you can install it as an "Unpacked Extension":

1.  **Clone or Download** this repository.
    ```bash
    git clone https://github.com/MoizDev/Gemini-Brancher.git
    ```
2.  Open **Chrome** and navigate to `chrome://extensions`.
3.  Enable **Developer Mode** (toggle in the top right).
4.  Click **Load Unpacked**.
5.  Select the folder where you cloned/downloaded this repository.

## 📖 How to Use

1.  Open any chat in **[Google Gemini](https://gemini.google.com)**.
2.  Hover over any message you want to "pivot" from.
3.  Click the **Branch** button (icon looks like a split arrow) that appears in the message toolbar.
4.  Sit back! GemBrancher will:
    *   Load all necessary history.
    *   Extract the conversation context.
    *   Open a new chat.
    *   Upload the context file.
    *   Instruct Gemini to restore your state.
5.  Start typing in your new timeline!

## 🛠️ Technical Details

*   **Hydration Scraper**: Uses an adaptive scrolling algorithm to ensure all DOM elements are rendered by Gemini's virtual scroller before extraction.
*   **Robust Uploading**: Detects Gemini's internal loading states (spinners, progress bars) to ensure context is fully processed before the first message is sent.
*   **State Management**: Handles file preview containers and "send" button states (`aria-disabled`) to prevent race conditions.

## 🤝 Contributing

Contributions are welcome! Please feel free to open issues or submit pull requests.

## 📄 License

[MIT License](LICENSE)
